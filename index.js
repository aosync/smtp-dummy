const express = require('express');
const app = express();
const port = 8198;
const { Client } = require('pg');
const client = new Client();
const { v4: uuidv4 } = require('uuid');
const { SMTPServer, SMTPClient } = require('./smtp');
const fs = require('fs');
const sanitizeHtml = require('sanitize-html');
const simpleParser = require('mailparser').simpleParser;

const SERVER_DOMAIN = '<insert here>';

main();

function toB64(str) {
    let buff = new Buffer.from(str);
    return buff.toString('base64');
}

function fromB64(b64) {
    let buff = new Buffer.from(b64, 'base64');
    return buff.toString('ascii');
}

async function main() {
    await client.connect();

    app.use(express.static('html'));

    app.use('/raw_emails', express.static('raw_emails'));

    app.get('/api', (req, res) => {
        res.send('there is nothing here dumbass....');
    });

    app.get('/api/email_count', async (req, res) => {
        let qres = await client.query('SELECT COUNT(*) FROM emails');
        let objRet = { count: qres.rows[0].count };
        res.contentType('json');
        res.send(JSON.stringify(objRet));
    });

    app.get('/api/emails', async (req, res) => {
        let offset = Number(req.query.offset);
        let count = Number(req.query.count);

        if (isNaN(offset) || isNaN(count)) {
            let objRet = { error: 'You forgot offset or count you sodding tic tac...' };
            res.status(400);
            res.contentType('json');
            res.send(JSON.stringify(objRet));
            return;
        }

        let qres = await client.query(`SELECT * FROM emails ORDER BY timestamp DESC LIMIT ${count} OFFSET ${offset}`);

        let objRet = { emails: qres.rows };
        res.contentType('json');
        res.send(JSON.stringify(objRet));
    });

    // uuid, timestamp, sender, recipîents, snippet

    const smtps = new SMTPServer(SERVER_DOMAIN, 25);
    smtps.on('mail', async (mail) => {
        let uuid = uuidv4();
        let timestamp = Math.floor(+new Date());
        let sender = `${mail.from.mailbox}@${mail.from.domain}`;
        let recipients = '';
        for (let i = 0; i < mail.to.length; i++) {
            recipients += `${mail.to[i].mailbox}@${mail.to[i].domain}`;
            if (i != (mail.to.length-1)) { recipients += ', '; }
        }
        let snippet = toB64(mail.data.substr(0, 1024));
        let sqlQuery = `INSERT INTO emails (uuid, timestamp, sender, recipients, snippet) VALUES ('${uuid}', '${timestamp}', '${sender}', '${recipients}', '${snippet}')`;
        let resp = await client.query(sqlQuery);

        simpleParser(mail.data, null, (err, parsed) => {
            if (err) {
                return;
            }
            parsed.smtp_sender = sender;
            parsed.smtp_recipients = recipients;
            parsed.html = sanitizeHtml(parsed.html);

            if (parsed.attachments.length > 0) {
                fs.mkdirSync(`raw_emails/${uuid}-attch`);
            }
            for (let i = 0; i < parsed.attachments.length; i++) {
                fs.writeFileSync(`raw_emails/${uuid}-attch/${parsed.attachments[i].filename ? parsed.attachments[i].filename : 'unknown'}`, Buffer.from(parsed.attachments[i].content));
                parsed.attachments[i].content = undefined;
            }

            fs.writeFileSync(`raw_emails/${uuid}.txt`, sanitizeHtml(mail.data));
            fs.writeFileSync(`raw_emails/${uuid}.json`, JSON.stringify(parsed));
        });

        console.log(`Email received from ${sender} ${uuid}`);

    });
    smtps.run();
    /*
    const mail = {
            from: {mailbox: "", domain: ""},
            to: [{mailbox: "", domain: ""}, {mailbox: "", domain: ""}, {mailbox: "", domain: ""}, ....],
            data: "",
    };
    */

    app.listen(port, () => {
        console.log(`Example app listening at http://localhost:${port}`);
    });
}