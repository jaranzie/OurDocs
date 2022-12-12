const fastify = require('fastify');
const { PrismaClient } = require('@prisma/client');
const fastifyCookie = require('@fastify/cookie');
const { v4: uuidv4 } = require('uuid');
const crpyto = require("crypto");
const Mailer = require("nodemailer")
const cluster = require('cluster');
const numCPUs = require('os').cpus().length;

const prisma = new PrismaClient()
const app = fastify();

app.register(fastifyCookie, {
        secret: "my-secret",
        hook: 'onRequest',
        parseOptions: {}
}
);

let transporter = Mailer.createTransport({
    sendmail: true,
    newline: 'unix',
    path: '/usr/sbin/sendmail'
})

sendVerificationEmail = async (user) => {
    const query_component = (`userid=${encodeURIComponent(user.id)}&authkey=${encodeURIComponent(user.authkey)}`);
    const verify_url = `http://group1.cse356.compas.cs.stonybrook.edu/users/verify?` + query_component;
    transporter.sendMail({
        to: user.email,
        from: 'verify@group1.cse356.compas.cs.stonybrook.edu', // Make sure you don't forget the < > brackets
        subject: 'Your verification code',
        text: verify_url
    })
}

// ***************************** 

app.post('/users/signup', async (request, reply) => {
    const { name, email, password } = request.body;
    if (name === undefined || email === undefined || password === undefined) {
        reply.send({"error": true, "message": "Missing Required Fields"});
    } else {
        const authkey = (await crpyto.randomBytes(10)).toString('hex');
        const user = await prisma.inactiveuser.create({
            data: {
                name: name,
                email: email,
                password: password,
                authkey: authkey
            }
        })
        sendVerificationEmail(user);
        reply.status(200).send({});
    }
})

app.get('/users/verify', async (request, reply) => {
    const {userid, authkey} = request.query;
    if(userid === undefined || authkey === undefined) {
        reply.send({"error": true, "message": "Missing Required Fields"});
    }
    const user = await prisma.inactiveuser.findUnique({
        where: {
            id: userid
        }
    })
    if (user === null) {
        reply.send({"error": true, "message": "Invalid url"});
    }
    if(user.authkey == authkey) {
        await Promise.all([prisma.inactiveuser.delete({
            where: {
                id:userid
            }
        }), prisma.user.create({
            data: {
                name: user.name,
                email: user.email,
                password: user.password,
            }
        })])
        reply.send({"status":"OK"});
    } else {
        reply.send({"error": true, "message": "Invalid Authetication Key"});
    }
})

app.post('/users/login', async (request, reply) => {
    const {email, password} = request.body;
    const user = await prisma.user.findUnique({
        where: {
            email: email
        }
    })
    if(user === null) {
        reply.send({"error": true, "message": "Email not associated with user"});
    } else if (password !== user.password) {
        reply.send({"error": true, "message": "Incorrect Password"});
    } else {
        const sessionId = uuidv4();
        await prisma.session.create({
            data: {
                sessionId: sessionId,
                userId: user.id,
		        name: user.name
            }
        });
        reply.setCookie('sessionId', sessionId, {
			path: '/'})
		    .send({"name": user.name});
    }
})

const start = async () => {
    try {
        await app.listen({ port: 3000, host: "0.0.0.0" })
    } catch (err) {
        app.log.error(err)
    }
}

function masterProcess() {
    console.log(`Master ${process.pid} is running`);
    for (let i = 0; i < numCPUs; i++) {
        console.log(`Forking process number ${i}...`);
        cluster.fork();
    }
}

function childProcess() {
    console.log(`Worker ${process.pid} started...`);
    start();
}


if (cluster.isMaster) {
    masterProcess();
} else {
    childProcess();
}




