/**
 * @file Главный скрипт сервера сервисов
 * @author mikhail "synzr" <mikhail@tskau.team>
 */

// eslint-disable-next-line no-unused-vars
const { Socket, createServer } = require('node:net')
const { processAvatar } = require('./processor')
const { getUserAvatar, getUserIdViaCredentials } = require('../../database')
const config = require('../../../config')
const { query } = require('winston')
const { generateXMLResponse } = require('./weather')
const { processNewMicroblog } = require('../mrim/processors/status.js')
const { ServerConstructor } = require('../../constructors/server')

const ALLOWED_METHODS = ['GET', 'HEAD']
const STATUS_CODES = {
  200: 'OK',
  400: 'Bad Request',
  404: 'Not Found',
  418: "I'm a teapot",
  500: 'Internal Server Error'
}

function obrazServer (options) {
  return new ServerConstructor({
    logger: options.logger,
    onConnection: connectionListener
  }).finish()
}

/**
 * @param {Socket} socket Сокет подключения
 */
function connectionListener (socket, connectionId, logger, variables) {
  socket.on('data', parse)

  /**
   * @param {Buffer} data Данные запроса
   */
  function parse (data) {
    data = data
      .toString('ascii')
      .split('\r\n')
      .filter((line) => line.length !== 0)

    const [method, pathname, version] = data[0].split(' ')
    const headers = Object.fromEntries(
      data.slice(1).map((header) => header.split(': '))
    )

    return requestListener({ method, pathname, version, headers })
  }

  /**
   * Ответить на HTTP-запрос
   *
   * @param {string} httpVersion Версия HTTP-протокола
   * @param {number} statusCode Статус-код
   * @param {string | Buffer | null} responseBody Данные ответа
   * @param {object | null} responseHeaders Заголовки ответа
   */
  function respond (httpVersion, statusCode, responseBody, responseHeaders) {
    if (typeof responseBody === 'string') {
      responseBody = Buffer.from(responseBody, 'utf8')
    }

    if (responseHeaders === null || responseHeaders === undefined) {
      responseHeaders = {}
    }

    responseHeaders.Server = 'mrim-server'

    if (responseBody !== null && !Object.keys(responseHeaders).includes('Content-Length')) {
      responseHeaders['Content-Length'] = responseBody.length
    }

    responseHeaders = Object.entries(responseHeaders)
      .map(([headerField, headerValue]) => `${headerField}: ${headerValue}\r\n`)
      .join('')

    let responseMessage = Buffer.from(
      `${httpVersion} ${statusCode} ${STATUS_CODES[statusCode] ?? ''}\r\n${responseHeaders}\r\n`,
      'ascii'
    )

    if (responseBody !== null) {
      responseMessage = Buffer.concat([responseMessage, responseBody])
    }

    try {
      return socket.end(responseMessage)
    } catch (e) {
      logger.error(`[${connectionId}] [obraz] internal error, stack: ${e.stack}`)
    }
  }

  /**
   * Обработка запроса
   * 
   * @param {Object} request Данные запроса
   */
  async function requestListener ({ method, pathname, version, headers }) {
    try {
      if (!ALLOWED_METHODS.includes(method)) {
        return respond(version, 418, "I'm a teapot")
      }

      if (pathname.startsWith('http')) {
        pathname = new URL(pathname).pathname
      }
      pathname = pathname.substring(1)
      let [uripath, queryValue] = pathname.split('?')
      let queryValues = {}

      if (queryValue !== undefined) {
        queryValue.split('&').forEach(element => {
          const [key, value] = element.split('=')
          queryValues[key] = value
        });
      }

      logger.debug(`[${connectionId}] [obraz] user visited uri ${pathname}`)

      /* mobile app promo */
      if (uripath.endsWith('/popup.html')) {
        let promoHtml = `<meta http-equiv="refresh" content="0; URL=${config.obraz.mobilePromoRedirect}" />`
        if (config.obraz.mobilePromoRedirect === undefined) {
          // fallback
          promoHtml = `<meta charset="utf-8">Похоже, админ не настроил редирект при триггере рекламы мобильного приложения. Сообщите ему об этой оплошности :)` 
        }
        return respond(version, 200, promoHtml)
      }

      /* weather */
      if (uripath === "inf/magent_main.xml") {
        if (queryValues['city'] !== undefined) {
          const xmlResponse = await generateXMLResponse(queryValues['city'])
          if (xmlResponse !== null) {
            logger.debug(`[${connectionId}] [obraz] someone got weather for cityid ${queryValues['city']}`)
            return respond(version, 200, xmlResponse)
          } else {
            return respond(version, 500, 'Internal Server Error')
          }
        }
      }

      /* sip */
      if (uripath === "cgi-bin/agentbalance") {
        return respond(version, 200, `<?xml version="1.0" encoding="UTF-8" ?>
          <BalanceResponse>
          <ResponseHeader>
          <VERSION>1</VERSION>
          </ResponseHeader>
          <Body>
          <SipId>1337</SipId>
          <Currency>Spamton</Currency>
          <Balance>0</Balance>
          </Body>
          </BalanceResponse>
          `, { 'Content-Type': 'text/xml'})
      }
	  
	  /* microblog */
      if (uripath === 'data/agentupload') {
        const login = queryValues['a'] ? decodeURIComponent(queryValues['a']) : '';
		const password = queryValues['b'] ? decodeURIComponent(queryValues['b']) : '';
        let text = queryValues['e'] ? decodeURIComponent(queryValues['e'].replace(/\+/g, '%20')) : '';
		const unoff = queryValues['f'] ? decodeURIComponent(queryValues['f']) : '';
        let flags = (unoff === 'music') ? 0x02 : 0x09;
		
        const [username, domain] = login.split('@');
		const connectionId = `http`; // а как иначе ало
		let client = null
		
		try {
		  const dbUserId = await getUserIdViaCredentials(username, domain, password);
		} catch (err) {
		    logger.debug(`[obraz] auth for ${login} failed: invalid login/password`);
			return respond(version, 200, '<response><status>401</status></response>', { 'Content-Type': 'text/xml' });
          }
		  
		try {
		  client = global.clients?.find(
			(c) => c.username?.toLowerCase() === username.toLowerCase() && 
                   c.domain?.toLowerCase() === domain.toLowerCase()
        );
	   } catch (err) {
          logger.error(`[obraz] internal error, stack: ${err.stack}`);
          return respond(version, 200, '<response><status>500</status></response>', { 'Content-Type': 'text/xml' });
        }
		  
        if (!client) {
          // if not online - 401 
          return respond(version, 200, '<response><status>401</status></response>', { 'Content-Type': 'text/xml' }); 
        }
        
		if (text.length > 500) {
           logger.debug(`[obraz] rejected microblog post from ${login}: text exceeds 500 characters`);
           return respond(version, 200, '<response><status>418</status></response>', { 'Content-Type': 'text/xml' });
        }
		
		if (unoff === 'nomusic') { text = ''; flags = 0x02; }
		
        try {
          await processNewMicroblog( null, null, connectionId, console, client, null, text, flags );
          return respond(version, 200, '<response><status>200</status></response>', { 'Content-Type': 'text/xml' });
          
        } catch (err) {
          logger.error(`[obraz] internal error, stack: ${err.stack}`);
          return respond(version, 200, '<response><status>500</status></response>', { 'Content-Type': 'text/xml' });
        } // mail.ru really didn't want to use normal http codes, so, they used 200 OK, and the real code was wrapped in xml
      }

      // processing pfp by default
      if (uripath.split('/').length !== 3) {
        return respond(version, 404, 'Not Found')
      } else {
        return await processObraz({method, uripath, version})
      }

    } catch (e) {
      logger.error(`[${connectionId}] [obraz] internal error, stack: ${e.stack}`)
    }
  }

  /**
   * Обработка запроса
   * 
   * @param {Object} request Данные запроса
   */
  async function processObraz ({ method, uripath, version }) {
    let [domain, userLogin, avatarType] = uripath.split('/')

    let avatarPath

    try {
      if (userLogin === config.adminProfile?.username && config.adminProfile?.domain.startsWith(domain) &&
        config.adminProfile?.avatarUrl !== null) {
        avatarPath = config.adminProfile.avatarUrl
      } else {
        avatarPath = await getUserAvatar(userLogin, domain)
      }
    } catch {
      return respond(version, 404, null, {
        Date: new Date().toUTCString(),
        'Content-Type': 'image/jpeg',
        'Content-Length': '0',
        'X-NoImage': '1'
      })
    }

    if (avatarPath === undefined) {
      return respond(version, 404, null, { Date: new Date().toUTCString(), 'Content-Type': 'image/jpeg', 'X-NoImage': '1' })
    }

    try {
      const avatar = await processAvatar((config.obraz.cdnPath ?? '') + avatarPath, avatarType)

      return respond(version, 200, method !== 'HEAD' ? avatar : null, {
        Date: new Date().toUTCString(),
        'Content-Type': 'image/jpeg',
        'Content-Length': avatar.length,
        'Cache-Control': 'max-age=604800',
        'Last-Modified': new Date().toUTCString(),
        Expires: new Date(Date.now() + 604_800_000).toUTCString()
      })
    } catch (e) {
      logger.error(`[${connectionId}] [obraz] internal error for ${userLogin}, path: ${(config.obraz.cdnPath ?? '') + avatarPath}, stack: ${e.stack}`)
      return respond(version, 500, null, { Date: new Date().toUTCString(), 'Content-Type': 'image/jpeg', 'X-NoImage': '1' })
    }
  }
}

module.exports = obrazServer
