import type { NextApiRequest, NextApiResponse } from 'next'

type HealthResponse = {
  status: 'ok'
  time: string
}

export default function handler(_req: NextApiRequest, res: NextApiResponse<HealthResponse>) {
  res.status(200).json({ status: 'ok', time: new Date().toISOString() })
}
