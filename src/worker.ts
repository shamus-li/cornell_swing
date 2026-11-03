import checkin from '../check-in/worker'
import events from './events/worker'
import { SQUARE_CRON, syncSquare } from './events/square'
import { FEEDS_CRON, readFeeds } from './events/feeds'
import { deliverRSVPs } from './events/sheets'

export { AttendanceSync, CheckinGuard } from '../check-in/worker'

export default {
  fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    const path = new URL(request.url).pathname
    return path === '/check-in' || path.startsWith('/check-in/')
      ? checkin.fetch(request, env)
      : events.fetch(request, env, ctx)
  },
  scheduled(controller, env) {
    if (controller.cron === FEEDS_CRON) return readFeeds(env)
    // The account's free plan limits scheduled triggers, so waiting RSVPs go out on Square's ten-minute one.
    if (controller.cron === SQUARE_CRON) return Promise.all([syncSquare(env), deliverRSVPs(env)]).then(() => {})
    return checkin.scheduled(controller, env)
  },
} satisfies ExportedHandler<Env>
