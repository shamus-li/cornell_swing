export const onRequest: PagesFunction<PagesEnv> = ({ request, env }) =>
  env.CHECKIN_API.fetch(request)
