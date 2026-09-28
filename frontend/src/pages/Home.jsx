import AdminHome from './admin/AdminHome.jsx'
import TeacherHome from './teacher/TeacherHome.jsx'
import { useApp } from '../lib/useApp.js'

export default function Home() {
  const { access } = useApp()
  return access === 'admin' ? <AdminHome /> : <TeacherHome />
}
