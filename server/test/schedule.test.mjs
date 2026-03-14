import assert from "node:assert/strict";
import test from "node:test";

import * as schedule from "../dist/lib/schedule.js";

test("stripXmlMarkup decodes nested entities and removes trailing source lines", () => {
    const raw = "<![CDATA[&lt;i&gt;Pilot&lt;/i&gt; &amp;amp; more<br/>Line 2<br/>Source: feed]]>";
    assert.equal(schedule.stripXmlMarkup(raw), "Pilot & more\nLine 2");
});

test("parseXmltvDate converts XMLTV timestamps with offsets", () => {
    const parsed = schedule.parseXmltvDate("20260314153000 -0400");
    assert.equal(parsed?.toISOString(), "2026-03-14T19:30:00.000Z");
});

test("normalizeScheduleXml keeps the Andromeda channel and strips episode HTML", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <channel id="other">
    <display-name>Other Channel</display-name>
  </channel>
  <channel id="andromeda-main">
    <display-name>1 Andromeda</display-name>
  </channel>
  <programme start="20260314100000 +0000" stop="20260314103000 +0000" channel="other">
    <title>Wrong Show</title>
    <desc>Should not be selected</desc>
  </programme>
  <programme start="20260314100000 +0000" stop="20260314103000 +0000" channel="andromeda-main">
    <title>Angel Cop</title>
    <sub-title><![CDATA[The Beginning]]></sub-title>
    <episode-num system="xmltv_ns">0.1.</episode-num>
    <desc><![CDATA[&lt;i&gt;Pilot&lt;/i&gt; &amp;amp; more<br/>Line 2<br/>Source: feed]]></desc>
  </programme>
  <programme start="20260314103000 +0000" stop="20260314110000 +0000" channel="andromeda-main">
    <title>Genocyber</title>
    <desc>Second slot</desc>
  </programme>
</tv>`;

    const payload = schedule.normalizeScheduleXml(xml, new Date("2026-03-14T10:05:00.000Z"));

    assert.equal(payload.fetchedAt, "2026-03-14T10:05:00.000Z");
    assert.equal(payload.refreshAfterMs, 300000);
    assert.equal(payload.schedule.length, 2);
    assert.deepEqual(payload.schedule[0], {
        title: "Angel Cop",
        episode: "S01E02 The Beginning",
        description: "Pilot & more\nLine 2",
        live: true,
        time: "live",
    });
    assert.equal(payload.schedule[1]?.title, "Genocyber");
});

test("normalizeScheduleXml handles single channel/programme nodes without array wrappers", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <channel id="solo">
    <display-name>Andromeda</display-name>
  </channel>
  <programme start="20260314120000 +0000" stop="20260314123000 +0000" channel="solo">
    <title><![CDATA[Bubblegum Crisis]]></title>
    <desc><![CDATA[&lt;b&gt;Classic&lt;/b&gt; OVA]]></desc>
  </programme>
</tv>`;

    const payload = schedule.normalizeScheduleXml(xml, new Date("2026-03-14T11:55:00.000Z"));

    assert.equal(payload.schedule.length, 1);
    assert.deepEqual(payload.schedule[0], {
        title: "Bubblegum Crisis",
        description: "Classic OVA",
        live: false,
        time: payload.schedule[0].time,
    });
    assert.match(payload.schedule[0].time ?? "", / - /);
});
