/*
  Smart Attendance — Arduino Uno R3 + R307/AS608 fingerprint sensor

  Talks to the Python backend over USB Serial and to the sensor over software
  serial. Library needed: "Adafruit Fingerprint Library" (Library Manager).

  Wiring (Uno):
    sensor RED / VCC  -> 5V        (use 3.3V if your module is 3.3V-only)
    sensor BLACK / GND-> GND
    sensor TX         -> D2  (Arduino RX, via software serial)
    sensor RX         -> D3  (Arduino TX)

  Protocol:
    -> FOUND_ID:<id> | NOT_FOUND | ENROLLED:<id> | BOOT | SCAN_READY
       ENROL_WAIT_1 | ENROL_WAIT_2 | ERROR:<msg>
    <- E:<id>  enrol a finger into a specific memory slot
       E       enrol into the next free slot
       P       ping
       q       abandon an in-progress enrolment
*/

#include <Adafruit_Fingerprint.h>
#include <SoftwareSerial.h>

#define SENSOR_RX 2
#define SENSOR_TX 3
#define SENSOR_BAUD 57600   // R307 ships at 57600; use 9600 for a stock AS608
#define USB_BAUD 57600
#define MAX_FINGERS 300
#define REPEAT_COOLDOWN_MS 3000
#define FINGER_WINDOW_MS 20000
#define LIFT_WINDOW_MS 8000

SoftwareSerial sensor(SENSOR_RX, SENSOR_TX);
Adafruit_Fingerprint finger = Adafruit_Fingerprint(&sensor);

int lastMatchedId = -1;
unsigned long lastMatchedAt = 0;
String pending;

void setup() {
  Serial.begin(USB_BAUD);
  sensor.begin(SENSOR_BAUD);
  finger.begin(SENSOR_BAUD);

  delay(1500);  // let the sensor power up

  if (finger.verifyPassword()) {
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
  if (finger.getImage() != FINGERPRINT_OK) return;
  if (finger.image2Tz() != FINGERPRINT_OK) return;

  uint8_t result = finger.fingerSearch();
  if (result == FINGERPRINT_NOTFOUND) {
    Serial.println(F("NOT_FOUND"));
    delay(400);  // let the student lift their finger before reporting again
    return;
  }
  if (result != FINGERPRINT_OK) return;

  unsigned long now = millis();
  bool isRepeat = finger.fingerID == lastMatchedId &&
                  (now - lastMatchedAt) < REPEAT_COOLDOWN_MS;
  lastMatchedId = finger.fingerID;
  lastMatchedAt = now;

  if (!isRepeat) {
    Serial.print(F("FOUND_ID:"));
    Serial.println(finger.fingerID);
  }
  blinkConfirm();
}

// requested == 0 lets the sensor choose the next free slot.
void enrollFinger(int requested) {
  Serial.println(F("ENROL_WAIT_1"));
  if (!captureTemplate(1)) return;
  Serial.println(F("ENROL_WAIT_2"));
  if (!captureTemplate(2)) return;

  if (finger.createModel() != FINGERPRINT_OK) {
    Serial.println(F("ERROR:TEMPLATES_DID_NOT_MATCH"));
    return;
  }

  // The library has no "find a free slot" call, so append past the count unless
  // the host asked for a specific one. backend/enroll.py and the web form both
  // pass the student's Fingerprint ID so the slot and the database agree.
  if (finger.getTemplateCount() != FINGERPRINT_OK) {
    Serial.println(F("ERROR:CANNOT_READ_LIBRARY"));
    return;
  }
  uint16_t location = requested > 0 ? (uint16_t)requested : finger.templateCount + 1;
  if (location > MAX_FINGERS || location < 1) {
    Serial.println(F("ERROR:LIBRARY_FULL"));
    return;
  }
  if (finger.storeModel(location) != FINGERPRINT_OK) {
    Serial.println(F("ERROR:STORE_FAILED"));
    return;
  }

  Serial.print(F("ENROLLED:"));
  Serial.println(location);
  blinkConfirm();
}

bool captureTemplate(uint8_t slot) {
  unsigned long deadline = millis() + FINGER_WINDOW_MS;
  while (millis() < deadline) {
    if (abandoned()) return false;
    uint8_t status = finger.getImage();
    if (status == FINGERPRINT_OK) {
      if (finger.image2Tz(slot) == FINGERPRINT_OK) return waitForLift();
    } else if (status != FINGERPRINT_NOFINGER) {
      delay(20);  // a failed read can repeat faster than the sensor likes
    }
  }
  Serial.println(F("ERROR:TIMEOUT"));
  return false;
}

// Without a clean lift the second read catches the finger half-raised, and
// createModel then rejects the pair as TEMPLATES_DID_NOT_MATCH.
bool waitForLift() {
  unsigned long deadline = millis() + LIFT_WINDOW_MS;
  while (millis() < deadline) {
    if (abandoned()) return false;
    if (finger.getImage() == FINGERPRINT_NOFINGER) {
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
