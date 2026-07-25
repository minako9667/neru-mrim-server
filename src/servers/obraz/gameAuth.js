/**
 * @file Реализация запроса на веб-игру
 * @author Neru Asano <neru.asano9667@gmail.com>
 */

const { Buffer } = require('node:buffer')

function parseGameParams (encodedIdent) {
  if (!encodedIdent) return null // sorry i cannot fulfill this request

  const decodedQuery = decodeURIComponent(encodedIdent)
  const params = new URLSearchParams(`ident=${decodedQuery}`)

  const ident = params.get('ident')
  const key = params.get('key')
  const rand = params.get('rand')

  let player = null
  let opponent = null

  if (rand) {
    const decodedRand = Buffer.from(rand, 'base64').toString('utf-8')
    const parts = decodedRand.split(';')
    player = parts[0]
    opponent = parts.length > 1 ? parts[1] : parts[0]
  }
  return { ident, key, rand, player, opponent }
}

module.exports = { parseGameParams }
