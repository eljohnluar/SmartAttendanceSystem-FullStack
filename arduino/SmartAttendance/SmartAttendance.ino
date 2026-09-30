/*
  Smart Attendance — Arduino Uno R3 + R307/AS608 fingerprint sensor

  Talks to the Python backend over USB Serial and to the sensor over software
  serial. The sensor driver at the top is self-contained (raw FPM packet
  protocol), so no library needs to be installed.

  Wiring (Uno):
    sensor RED / VCC  -> 5V        (use 3.3V if your module is 3.3V-only)
    sensor BLACK / GND-> GND
    sensor TX         -> D2  (Arduino RX, via software serial)
    sensor RX         -> D3  (Arduino TX)

  Protocol:
    -> FOUND_ID:<id> | NOT_FOUND | ENROLLED:<id> | DELETED:<id> | BOOT | SCAN_READY
       ENROL_WAIT_1 | ENROL_SEEN_1 | ENROL_LIFT | ENROL_WAIT_2 | ENROL_SEEN_2 | ERROR:<msg>
    <- E:<id>  enrol a finger into a specific memory slot
       E       enrol into the next free slot
       D:<id>  delete the template stored in a slot
       P       ping
       q       abandon an in-progress enrolment
*/

#include <SoftwareSerial.h>

#define SENSOR_RX 2
#define SENSOR_TX 3
#define SENSOR_BAUD 57600   // R307 ships at 57600; use 9600 for a stock AS608
#define USB_BAUD 57600
#define MAX_FINGERS 300
#define REPEAT_COOLDOWN_MS 3000
#define FINGER_WINDOW_MS 20000
#define LIFT_WINDOW_MS 8000
#define REPLY_TIMEOUT_MS 1000

// Sensor confirm codes the flow branches on; anything else is reported raw.
#define FP_OK 0x00
#define FP_NOFINGER 0x02
#define FP_NOTFOUND 0x09
#define FP_ENROLLMISMATCH 0x0A

SoftwareSerial sensor(SENSOR_RX, SENSOR_TX);

int lastMatchedId = -1;
unsigned long lastMatchedAt = 0;
String pending;
uint16_t matchedId = 0;
uint16_t templateTotal = 0;

// ── FPM packet driver ───────────────────────────────────────────────
// Command: EF 01 <4-byte address> 01 <length> <data> <checksum>.
// Reply:   same frame with packet id 07 and the confirm code first in data.
// Length and checksum are big-endian; the checksum covers packet id, length
// and data.

void writePacket(const uint8_t *data, uint8_t n) {
  uint16_t length = n + 2;  // data plus the two checksum bytes
  uint16_t sum = 0x01 + (length >> 8) + (length & 0xFF);
  for (uint8_t i = 0; i < n; i++) sum += data[i];

  sensor.write((uint8_t)0xEF);
  sensor.write((uint8_t)0x01);
  sensor.write((uint8_t)0xFF);
  sensor.write((uint8_t)0xFF);
  sensor.write((uint8_t)0xFF);
  sensor.write((uint8_t)0xFF);
  sensor.write((uint8_t)0x01);
  sensor.write((uint8_t)(length >> 8));
  sensor.write((uint8_t)(length & 0xFF));
  sensor.write(data, n);
  sensor.write((uint8_t)(sum >> 8));
  sensor.write((uint8_t)(sum & 0xFF));
}

int readByte(unsigned long deadline) {
  while (!sensor.available()) {
    if (millis() > deadline) return -1;
  }
  return sensor.read();
}

/** Reads one reply frame; fills reply with the data bytes and returns how
    many, or -1 when the sensor stayed silent or the frame was corrupt. */
int8_t readPacket(uint8_t *reply, uint8_t capacity) {
  unsigned long deadline = millis() + REPLY_TIMEOUT_MS;

  if (readByte(deadline) != 0xEF) return -1;
  if (readByte(deadline) != 0x01) return -1;
  for (uint8_t i = 0; i < 4; i++) {
    if (readByte(deadline) < 0) return -1;  // address, ignored
  }
  int pid = readByte(deadline);
  int hi = readByte(deadline);
  int lo = readByte(deadline);
  if (pid < 0 || hi < 0 || lo < 0) return -1;

  uint16_t length = ((uint16_t)hi << 8) | (uint16_t)lo;
  if (length < 2 || length - 2 > capacity) return -1;
  uint8_t n = length - 2;

  uint16_t sum = (uint16_t)pid + (uint16_t)hi + (uint16_t)lo;
  for (uint8_t i = 0; i < n; i++) {
    int value = readByte(deadline);
    if (value < 0) return -1;
    reply[i] = (uint8_t)value;
    sum += (uint8_t)value;
  }
  int sh = readByte(deadline);
  int sl = readByte(deadline);
  if (sh < 0 || sl < 0) return -1;
  if (((sh << 8) | sl) != (sum & 0xFFFF)) return -1;

  return pid == 0x07 ? (int8_t)n : -1;
}

/** Sends a command and returns the confirm code, or 0xFF on no usable reply. */
uint8_t request(const uint8_t *command, uint8_t n, uint8_t *reply, uint8_t capacity) {
  writePacket(command, n);
  return readPacket(reply, capacity) > 0 ? reply[0] : 0xFF;
}

bool verifyPassword() {
  uint8_t cmd[5] = {0x13, 0x00, 0x00, 0x00, 0x00};
  uint8_t reply[8];
  return request(cmd, sizeof(cmd), reply, sizeof(reply)) == FP_OK;
}

uint8_t genImage() {
  uint8_t cmd[1] = {0x01};
  uint8_t reply[8];
  return request(cmd, sizeof(cmd), reply, sizeof(reply));
}

uint8_t imageToTz(uint8_t buffer) {
  uint8_t cmd[2] = {0x02, buffer};
  uint8_t reply[8];
  return request(cmd, sizeof(cmd), reply, sizeof(reply));
}

/** Leaves the matching slot in matchedId when it returns FP_OK. */
uint8_t search(uint8_t buffer, uint16_t start, uint16_t count) {
  uint8_t cmd[6] = {0x04, buffer,
                    (uint8_t)(start >> 8), (uint8_t)(start & 0xFF),
                    (uint8_t)(count >> 8), (uint8_t)(count & 0xFF)};
  uint8_t reply[8];
  uint8_t confirm = request(cmd, sizeof(cmd), reply, sizeof(reply));
  if (confirm == FP_OK) matchedId = ((uint16_t)reply[1] << 8) | reply[2];
  return confirm;
}

uint8_t regModel() {
  uint8_t cmd[1] = {0x05};
  uint8_t reply[8];
  return request(cmd, sizeof(cmd), reply, sizeof(reply));
}

uint8_t storeModel(uint8_t buffer, uint16_t location) {
  uint8_t cmd[4] = {0x06, buffer,
                    (uint8_t)(location >> 8), (uint8_t)(location & 0xFF)};
  uint8_t reply[8];
  return request(cmd, sizeof(cmd), reply, sizeof(reply));
}

/** Leaves the library size in templateTotal when it returns FP_OK. */
uint8_t readTemplateCount() {
  uint8_t cmd[1] = {0x1D};
  uint8_t reply[8];
  uint8_t confirm = request(cmd, sizeof(cmd), reply, sizeof(reply));
  if (confirm == FP_OK) templateTotal = ((uint16_t)reply[1] << 8) | reply[2];
  return confirm;
}

/** Wipes one slot, e.g. a transferred student's stale print. */
uint8_t deleteModel(uint16_t location) {
  uint8_t cmd[5] = {0x0C,
                    (uint8_t)(location >> 8), (uint8_t)(location & 0xFF),
                    0x00, 0x01};
  uint8_t reply[8];
  return request(cmd, sizeof(cmd), reply, sizeof(reply));
}

// ── Attendance sketch ───────────────────────────────────────────────

void setup() {
  Serial.begin(USB_BAUD);
  sensor.begin(SENSOR_BAUD);

  delay(1500);  // let the sensor power up

  if (verifyPassword()) {
    Serial.println(F("BOOT"));
  } else {
    Serial.println(F("ERROR:SENSOR_NOT_RESPONDING"));
  }
  Serial.println(F("SCAN_READY"));
}

void loop() {
  pollSerial();
  checkForFinger();
}

void pollSerial() {
  while (Serial.available()) {
    char incoming = (char)Serial.read();
    if (incoming == '\n' || incoming == '\r') {
      if (pending.length()) handleCommand(pending);
      pending = "";
    } else if (pending.length() < 15) {
      pending += incoming;
    }
  }
}

void handleCommand(String command) {
  command.trim();
  command.toUpperCase();

  if (command == "P") {
    Serial.println(F("OK"));
  } else if (command == "D" || command.startsWith("D:")) {
    int separator = command.indexOf(':');
    int slot = separator >= 0 ? command.substring(separator + 1).toInt() : 0;
    if (slot < 1 || slot > MAX_FINGERS) {
      Serial.println(F("ERROR:BAD_SLOT"));
      return;
    }
    if (deleteModel(slot) == FP_OK) {
      Serial.print(F("DELETED:"));
      Serial.println(slot);
    } else {
      Serial.println(F("ERROR:DELETE_FAILED"));
    }
  } else if (command == "E" || command.startsWith("E:")) {
    int separator = command.indexOf(':');
    int slot = separator >= 0 ? command.substring(separator + 1).toInt() : 0;
    if (slot < 0 || slot > MAX_FINGERS) {
      Serial.println(F("ERROR:BAD_SLOT"));
      return;
    }
    enrollFinger(slot);
  }
}

void checkForFinger() {
  if (genImage() != FP_OK) return;
  if (imageToTz(1) != FP_OK) return;

  uint8_t result = search(1, 0, MAX_FINGERS);
  if (result == FP_NOTFOUND) {
    Serial.println(F("NOT_FOUND"));
    delay(400);  // let the student lift their finger before reporting again
    return;
  }
  if (result != FP_OK) return;

  unsigned long now = millis();
  bool isRepeat = matchedId == (uint16_t)lastMatchedId &&
                  (now - lastMatchedAt) < REPEAT_COOLDOWN_MS;
  lastMatchedId = matchedId;
  lastMatchedAt = now;

  if (!isRepeat) {
    Serial.print(F("FOUND_ID:"));
    Serial.println(matchedId);
  }
  blinkConfirm();
}

// requested == 0 lets the sensor choose the next free slot.
void enrollFinger(int requested) {
  Serial.println(F("ENROL_WAIT_1"));
  if (!captureTemplate(1)) return;
  Serial.println(F("ENROL_WAIT_2"));
  if (!captureTemplate(2)) return;

  uint8_t model = regModel();
  if (model == FP_ENROLLMISMATCH) {
    Serial.println(F("ERROR:TEMPLATES_DID_NOT_MATCH"));
    return;
  }
  if (model != FP_OK) {
    Serial.print(F("ERROR:MODEL_"));
    Serial.println(model, HEX);
    return;
  }

  // The protocol has no "find a free slot" call, so append past the count
  // unless the host asked for a specific one. backend/enroll.py and the web
  // form both pass the student's Fingerprint ID so slot and database agree.
  if (readTemplateCount() != FP_OK) {
    Serial.println(F("ERROR:CANNOT_READ_LIBRARY"));
    return;
  }
  uint16_t location = requested > 0 ? (uint16_t)requested : templateTotal + 1;
  if (location > MAX_FINGERS || location < 1) {
    Serial.println(F("ERROR:LIBRARY_FULL"));
    return;
  }
  if (storeModel(1, location) != FP_OK) {
    Serial.println(F("ERROR:STORE_FAILED"));
    return;
  }

  Serial.print(F("ENROLLED:"));
  Serial.println(location);
  blinkConfirm();
}

bool captureTemplate(uint8_t buffer) {
  unsigned long deadline = millis() + FINGER_WINDOW_MS;
  bool announced = false;
  while (millis() < deadline) {
    if (abandoned()) return false;
    uint8_t status = genImage();
    if (status == FP_OK) {
      // The glass sees the finger before the slower convert finishes, so say
      // so now and the screen can confirm the press instead of looking dead.
      if (!announced) {
        announced = true;
        Serial.print(F("ENROL_SEEN_"));
        Serial.println(buffer);
      }
      if (imageToTz(buffer) == FP_OK) {
        // The first print landing is exactly when the user must lift, so say
        // so now instead of leaving them pressed on the glass.
        if (buffer == 1) Serial.println(F("ENROL_LIFT"));
        return waitForLift();
      }
      delay(20);
    } else if (status != FP_NOFINGER) {
      delay(20);  // a failed read can repeat faster than the sensor likes
    }
  }
  Serial.println(F("ERROR:TIMEOUT"));
  return false;
}

// Without a clean lift the second read catches the finger half-raised, and
// regModel then rejects the pair as TEMPLATES_DID_NOT_MATCH.
bool waitForLift() {
  unsigned long deadline = millis() + LIFT_WINDOW_MS;
  while (millis() < deadline) {
    if (abandoned()) return false;
    if (genImage() == FP_NOFINGER) {
      delay(150);  // let the surface settle before the next read
      return true;
    }
  }
  return true;  // a sensor that never reports "no finger" must not abort the pair
}

bool abandoned() {
  while (Serial.available()) {
    if (Serial.read() == 'q') {
      Serial.println(F("ERROR:CANCELLED"));
      return true;
    }
  }
  return false;
}

void blinkConfirm() {
  // Onboard LED on D13 flashes so students get feedback without a screen.
  pinMode(13, OUTPUT);
  digitalWrite(13, HIGH);
  delay(80);
  digitalWrite(13, LOW);
}
