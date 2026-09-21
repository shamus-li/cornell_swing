import checkin from '../check-in/worker'
import events from './events/worker'

export { CheckinGuard } from '../check-in/worker'

export default {
  fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    const path = new URL(request.url).pathname
    return path === '/check-in' || path.startsWith('/check-in/')
      ? checkin.fetch(request, env)
      : events.fetch(request, env, ctx)
  },
  scheduled: checkin.scheduled,
} satisfies ExportedHandler<Env>
