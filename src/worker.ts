import checkin, { checkWaiverForm } from '../check-in/worker'
import events from './events/worker'
import { syncSquare } from './events/square'
import { readFeeds } from './events/feeds'
import { deliverRSVPs } from './events/sheets'

export { AttendanceSync, CheckinGuard } from '../check-in/worker'

export default {
  fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    const path = new URL(request.url).pathname
    return path === '/check-in' || path.startsWith('/check-in/')
      ? checkin.fetch(request, env)
      : events.fetch(request, env, ctx)
  },
  // Every job runs on the morning schedule, and each one finishes even when another fails.
  async scheduled(controller, env) {
    const jobs = [checkin.scheduled(controller, env), checkWaiverForm(env), syncSquare(env), deliverRSVPs(env), readFeeds(env)]
    const failed = (await Promise.allSettled(jobs)).find(result => result.status === 'rejected')
    if (failed) throw failed.reason
  },
} satisfies ExportedHandler<Env>
