import {defineMcpClientConnection} from 'eve/connections'

import extension from '../extension'

export default defineMcpClientConnection({
  url: extension.config.url,
  description: 'Content from Sanity Context.',
  auth: {getToken: async () => ({token: extension.config.token})},
})
