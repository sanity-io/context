import {defineMcpClientConnection} from 'eve/connections'

import {version} from '../../package.json' with {type: 'json'}
import extension from '../extension'

export default defineMcpClientConnection({
  url: extension.config.url,
  description: extension.config.description,
  auth: {getToken: async () => ({token: extension.config.token})},
  headers: {'User-Agent': `sanity-context-eve/${version}`},
  // The endpoint speaks the initialize handshake, so skip the server/discover probe eve sends first.
  protocolVersionDiscovery: false,
})
