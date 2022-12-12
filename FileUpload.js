const { S3Client } = require('@aws-sdk/client-s3')
const Fastify = require('fastify');
const fastifyCookie = require('@fastify/cookie');
const multer = require('fastify-multer') // or import multer from 'fastify-multer'
const multerS3 = require('multer-s3')
const proxy = require('@fastify/http-proxy')
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient()

const cluster = require('cluster');
const numCPUs = require('os').cpus().length;

const s3Config = {
    endpoint: 'https://group1-internal.us-nyc1.upcloudobjects.com',
    region: 'US-NYC1',
    credentials: {
        accessKeyId: 'UCOBMBDCN3XK5PK9LXBB',
        secretAccessKey: 'YaMHuDuxqGaUpodzQt4geLf3Z3cUp1KOvDaNeo4m',
    },
}

const s3 = new S3Client(s3Config);
const upload = multer({
    storage: multerS3({
        s3: s3,
        bucket: 'milestone2',
        contentType: multerS3.AUTO_CONTENT_TYPE,
        metadata: function (req, file, cb) {
            cb(null, {contentType: file.mimetype});
            },
        key: function (req, file, cb) {
            cb(null, Date.now().toString())
        }
    }),
    fileFilter: fileFilter
})

const fastify = Fastify();
fastify.register(fastifyCookie);
fastify.register(multer.contentParser)

fastify.addHook('preValidation', (request, reply, done) => {
    done()
    return;
    authenticate(request, reply);
    done()
  })

function fileFilter (request, file, cb) {
    if (file.mimetype == "image/gif" || file.mimetype == "image/jpg" || file.mimetype == "image/png" || file.mimetype == "image/jpeg") {
        cb(null, true);
        return;
    }
    cb(null, false)
}

const authenticate = async (request, reply) => {
    if (request.cookies.sessionId) {
        const session = await prisma.session.findUnique({
            where: {
                sessionId: request.cookies.sessionId
            }
        })
        if (session == null) {
            reply.send({"error": true, "message": "Not logged in"});
        }
    } else {
        reply.send({"error": true, "message": "Not logged in"});
    }
}

fastify.post('/media/upload', { preHandler: upload.any() }, async (request, reply) => {
    const mimetype = request.files[0].mimetype
    if (mimetype == "image/gif" || mimetype != "image/jpg" && mimetype != "image/png" && mimetype != "image/jpeg") {
        reply.send({"error": true, "message": "Type not accepted"});
    } else {
        reply.send({mediaid: request.files[0].key})
    }
})

fastify.register(proxy, {
    upstream: 'https://milestone2.group1-internal.us-nyc1.upcloudobjects.com',
    prefix: '/media/access', // optional
    rewritePrefix: '',
    http2: true, // optional
    preHandler: authenticate
})

const start = async () => {
    try {
        await fastify.listen({ port: 1234, host: "0.0.0.0" })
    } catch (err) {
        fastify.log.error(err)
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