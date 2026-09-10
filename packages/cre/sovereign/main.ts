import { Runner } from '@chainlink/cre-sdk'
import { configSchema } from '../src/config'
import { chainPorts } from '../src/chain'
import { registerHandlers } from '../src/handler'

export async function main() {
  const runner = await Runner.newRunner({ configSchema })
  await runner.run(config => registerHandlers(config, chainPorts))
}
main()