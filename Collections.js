const fastify = require('fastify');
const fastifyCookie = require('@fastify/cookie');
const { PrismaClient } = require('@prisma/client');
const app = fastify({logger:true});
const prisma = new PrismaClient()
const emptyDocument = Buffer.from(new Uint8Array([0, 0]).buffer); // change if using V2
app.register(fastifyCookie, {
	secret: "my-secret",
	hook: 'onRequest',
	parseOptions: {}
}
);

const authenticate = async (request) => {
	if (request.cookies.sessionId == undefined) {
		return null;
	}
    return await prisma.session.findUnique({
        where: {
            sessionId: request.cookies.sessionId
        }
    })
}

const max_nodes = 16;

let doc_num = -1;
const get_doc_num = () => {
    doc_num = (doc_num + 1) % max_nodes;
    if(doc_num < 10) {
        return String(doc_num);
    }
    return doc_num;
}

let topTen = [];
const updateTopTen = async (id) => {
    let index = -1;
    for (let i = 0; i < topTen.length; i++) {
	if (topTen[i].id == id) {
	    index = i;
	    break;
	}
    }
    if (index === -1) {
        const doc = await prisma.document.findUnique({
            where: {
                id: id.slice(2)
            }
        })
        topTen.unshift({id:id, name:doc.name});
    } else {
        const doc = topTen[index];
        topTen.splice(index,1);
        topTen.unshift(doc);
    }
    if (topTen.length > 200) {
        topTen = topTen.slice(0,100);
    }
}

const deleteFromTopTen = async (id) => {
	for (let i = 0; i < topTen.length; i++) {
        if (topTen[i].id == id) {
            topTen.splice(i,1);
            break;
        }
    }
}

app.get('/:id', async (request, reply) => {
    const id = request.params.id;
    updateTopTen(id);
    reply.send({})
})

app.post("/collection/create", async (request, reply) => {
    const session = await authenticate(request)
    if (!(session)) {
        reply.send({"error": true, "message": "Not logged in"});
        return;
    } 
    const {name} = request.body;
    const database_doc = await prisma.document.create({
        data: {
            name: name,
            update: emptyDocument
        }
    })
    await updateTopTen(database_doc.id);
    reply.send({id:`${get_doc_num()}${database_doc.id}`})
})

app.post("/collection/delete", async (request, reply) => {
	const session = await authenticate(request)
    if (!(session)) {
        reply.send({"error": true, "message": "Not logged in"});
        return;
    }
    const {id} = request.body;
    await deleteFromTopTen(id) // Room for promise.all
    const delete_doc = await prisma.document.delete({
        where: {
            id: id.slice(2)
        }
    });
    if (delete_doc === null) {
        reply.send({"error": true, "message": "Document not found"});
        return
    }
    reply.send({"status":"OK"});
})

app.get(`/collection/list`, async (request, reply) => {
    const session = await authenticate(request)
    if (!(session)) {
        reply.send({"error": true, "message": "Not logged in"});
        return;
    }
    reply.send(topTen.slice(0,10));
})

const start = async () => {
    try {
        await app.listen({ port: 3000, host: "0.0.0.0" })
    } catch (err) {
        app.log.error(err)
    }
}
start();