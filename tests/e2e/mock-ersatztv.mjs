import http from 'node:http'

const port = Number(process.env.MOCK_ERSATZTV_PORT || 8409)

function toXmltvStamp(date) {
  const year = String(date.getUTCFullYear()).padStart(4, '0')
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  const hour = String(date.getUTCHours()).padStart(2, '0')
  const minute = String(date.getUTCMinutes()).padStart(2, '0')
  const second = String(date.getUTCSeconds()).padStart(2, '0')

  return `${year}${month}${day}${hour}${minute}${second} +0000`
}

function buildXmltv() {
  const now = new Date()
  const liveStart = new Date(now.getTime() - 5 * 60_000)
  const liveEnd = new Date(now.getTime() + 25 * 60_000)
  const nextStart = new Date(liveEnd.getTime())
  const nextEnd = new Date(nextStart.getTime() + 30 * 60_000)

  return `<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <channel id="andromeda-main">
    <display-name>1 Andromeda</display-name>
  </channel>
  <programme start="${toXmltvStamp(liveStart)}" stop="${toXmltvStamp(liveEnd)}" channel="andromeda-main">
    <title>Angel Cop</title>
    <sub-title><![CDATA[The Beginning]]></sub-title>
    <episode-num system="xmltv_ns">0.1.</episode-num>
    <desc><![CDATA[&lt;i&gt;Pilot&lt;/i&gt; &amp;amp; more<br/>Line 2<br/>Source: feed]]></desc>
  </programme>
  <programme start="${toXmltvStamp(nextStart)}" stop="${toXmltvStamp(nextEnd)}" channel="andromeda-main">
    <title>Genocyber</title>
    <desc>Second slot</desc>
  </programme>
</tv>`
}

const playlist = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXT-X-MEDIA-SEQUENCE:0
#EXTINF:10.0,
/iptv/session/1/segment0.ts
#EXT-X-ENDLIST
`

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url || '/', `http://127.0.0.1:${port}`)

  if (requestUrl.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
    return
  }

  if (requestUrl.pathname === '/iptv/xmltv.xml') {
    res.writeHead(200, {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(buildXmltv())
    return
  }

  if (requestUrl.pathname === '/iptv/session/1/hls.m3u8') {
    res.writeHead(200, {
      'content-type': 'application/vnd.apple.mpegurl',
      'cache-control': 'no-store',
    })
    res.end(playlist)
    return
  }

  if (requestUrl.pathname === '/iptv/session/1/segment0.ts') {
    res.writeHead(200, {
      'content-type': 'video/mp2t',
      'cache-control': 'no-store',
    })
    res.end(Buffer.alloc(188))
    return
  }

  res.writeHead(404, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: 'not found' }))
})

server.listen(port, '127.0.0.1', () => {
  console.log(`mock ersatztv listening on ${port}`)
})

function shutdown() {
  server.close(() => {
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
