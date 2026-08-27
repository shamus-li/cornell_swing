import { handleApiRequest } from "../../../checkin/worker"

export const onRequest: PagesFunction<Env> = ({ request, env }) => handleApiRequest(request, env)
