import {defineMcpClientConnection} from 'eve/connections'

import extension from '../extension'

export default defineMcpClientConnection({
  url: extension.config.url,
  description: extension.config.description,
  auth: {getToken: async () => ({token: extension.config.token})},
})
