import {defineMcpClientConnection} from 'eve/connections'

import extension from '../extension'

export default defineMcpClientConnection({
  url: extension.config.url,
  description: extension.config.description,
  auth: {getToken: async () => ({token: extension.config.token})},
  // The endpoint speaks the initialize handshake, so skip the server/discover probe eve sends first.
  protocolVersionDiscovery: false,
})
