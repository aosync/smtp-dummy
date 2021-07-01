const net = require('net');
const parseEmailAddress = require('./mailAddress').parseEmailAddress;
const EventEmitter = require('events').EventEmitter;

const SMTPReplyCodes = {
    READY: "220",
    QUIT: "221",
    MAIL_OK: "250",
    START_MAIL_DATA: "354",
    SYNTAX_ERROR: "500",
    BAD_SEQUENCE: "503"
};

process.on('uncaughtException', function (err) {
    console.error(err.stack);
    console.log("Not exiting.");
});

class SMTPServer extends EventEmitter {
    constructor(domain, port) {
        super();
        this.domain = domain;
        this.port = port;
        this.serv = net.createServer((c) => {
            let smtpc = new SMTPClient(c, this);
        });
    }

    run() {
        this.serv.listen(this.port);
    }
}

module.exports.SMTPServer = SMTPServer;

class SMTPClient {
    constructor(client, serv) {
        this.client = client;
        this.serv = serv;

        this.events = {};
        this.mail_ = null;
        this.rcpts = [];
        this.data_mode = false;
        this.data_ = '';

        this.hasCarriageReturn = false;
        this.commandTxt = '';
        this.state = 0;

        client.on('end', () => {
            // console.log("<client> disconnected");
        });
        client.on('error', (err) => {
            client.end();
            console.error(err);
        });

        this.ready();

        const that = this;
        client.on('data', (chunk) => {
            that.data(chunk);
        });
    }

    send(msg) {
        this.client.write(msg + '\r\n');
    }
    ready() {
        this.send(SMTPReplyCodes.READY + ' ' + this.serv.domain + " ESMTP Postfix");
    }
    helo(cmsp) {
        this.send(`${SMTPReplyCodes.MAIL_OK} ${this.serv.domain} glad to meet you`);
    }
    mail(cmsp) {
        const args = cmsp.slice(1);
        let attributes = {};
        for (let i = 0; i < args.length; i++) {
            let attr = args[i].split(':');

            switch (attr[0].toUpperCase()) {
            case 'FROM':
                attributes['FROM'] = parseEmailAddress(attr[1]);
                // console.log(attributes['FROM']);
                break;
            default:
                console.log('client>mail>unknown argument: ' + attr[0]);
            }
        }
        if(!attributes['FROM']) {
            this.send("553");
            return;
        }

        this.mail_ = attributes;
        this.send(SMTPReplyCodes.MAIL_OK);
    }
    rcpt(cmsp) {
        const args = cmsp.slice(1);
        let attributes = {};

        for (let i = 0; i < args.length; i++) {
            let attr = args[i].split(':');

            switch (attr[0].toUpperCase()) {
            case 'TO':
                attributes['TO'] = parseEmailAddress(attr[1]);
                // console.log(attributes['TO']);
                break;
            default:
                console.log('client>rcpt>unknown argument: ' + attr[0]);
            }
        }
        if(!attributes['TO']) {
            this.send("553");
            return;
        }

        this.rcpts.push(attributes);
        this.send(SMTPReplyCodes.MAIL_OK);
    }

    end_data() {
        if (!this.mail_ || !this.rcpts) {
            this.send(SMTPReplyCodes.BAD_SEQUENCE);
            return;
        }

        this.send(SMTPReplyCodes.MAIL_OK);

        const mail = {
            from: this.mail_['FROM'],
            to: this.rcpts.map((r) => r['TO']),
            data: this.data_,
        };

        // console.log(mail);
        this.serv.emit('mail', mail);

        this.mail_ = null;
        this.rcpts = [];
        this.data_ = '';
    }

    syntaxError() {
        this.send(SMTPReplyCodes.SYNTAX_ERROR);
    }

    command(cmd) {
        // console.log(cmd);
        let cmsp = cmd.split(' ');
        switch (cmsp[0]) {
        case 'HELO':
            this.helo(cmsp);
            break;
        case 'MAIL':
            this.mail(cmsp);
            break;
        case 'RCPT':
            this.rcpt(cmsp);
            break;
        case 'DATA':
            this.data_mode = true;
            this.send(SMTPReplyCodes.START_MAIL_DATA);
            break;
        case 'QUIT':
            this.send(SMTPReplyCodes.QUIT);
            this.client.end();
            break;
        default:
            this.syntaxError();
        }
    }
    data(chunkBuf) {
        let chunk = chunkBuf.toString('utf8');
        if (this.data_mode) {
            this.data_ += chunk;
            let ind = this.data_.indexOf('\r\n.\r\n');
            if (ind >= 0) {
                this.data_ = this.data_.slice(0, ind);
                this.data_mode = false;
                this.end_data();
            }
            return;
        }
        for (let i = 0; i < chunk.length; i++) {
            if (chunk[i] == '\r') {
                this.commandTxt += '\r';
                this.hasCarriageReturn = true;
                continue;
            }

            if (chunk[i] == '\n' && this.hasCarriageReturn) {
                this.commandTxt = this.commandTxt.slice(0, this.commandTxt.length - 1);
                this.command(this.commandTxt);
                this.commandTxt = '';
                this.hasCarriageReturn = false;
                continue;
            }

            this.hasCarriageReturn = false;
            this.commandTxt += chunk[i];
        } 
    }
}

module.exports.SMTPClient = SMTPClient;