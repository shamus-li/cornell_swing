import { GraduationCapIcon, MusicIcon } from "lucide-react"
import { lessonSchedule, type EventRecord } from "./model"

// One line each for the lesson and the social dance.
export const LessonTimes = ({ event }: { event: EventRecord }) => lessonSchedule(event).map(({ kind, text }) =>
  <p key={kind} className="schedule-times icon-line">{kind === "lesson" ? <GraduationCapIcon aria-hidden="true" /> : <MusicIcon aria-hidden="true" />}<span>{text}</span></p>)
