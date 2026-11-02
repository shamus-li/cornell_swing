import checkin from '../check-in/worker'
import events from './events/worker'
import { SQUARE_CRON, syncSquare } from './events/square'

export { AttendanceSync, CheckinGuard } from '../check-in/worker'

export default {
  fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    const path = new URL(request.url).pathname
    return path === '/check-in' || path.startsWith('/check-in/')
      ? checkin.fetch(request, env)
      : events.fetch(request, env, ctx)
  },
  scheduled(controller, env) {
    return controller.cron === SQUARE_CRON ? syncSquare(env) : checkin.scheduled(controller, env)
  },
} satisfies ExportedHandler<Env>
