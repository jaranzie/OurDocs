const fastify = require('fastify');
const http = require("http")
const fastifyCookie = require('@fastify/cookie');
const { PrismaClient } = require('@prisma/client');
const  Y  = require("yjs");
const { Client } = require('@elastic/elasticsearch');
const prisma = new PrismaClient()
const app = fastify({});

const timeout = process.env.timeout;

app.register(fastifyCookie, {
	secret: "my-secret",
	hook: 'onRequest',
	parseOptions: {}
}
);

const emptyDocument = Buffer.from(new Uint8Array([0, 0]).buffer);
let activeDocuments = new Map(); // id : {clients, ydoc, presence, queue }
let clientConnections = new Map(); // client sessionId to reply.raw

const authenticate = async (request) => {
	if (request.cookies.sessionId == undefined) {
		return null;
	}
    if (clientConnections.has(request.cookies.sessionId)) {
        return clientConnections.get(request.cookies.sessionId)
    } else {
        const session = await prisma.session.findUnique({
            where: {
                sessionId: request.cookies.sessionId
            }
    })
        clientConnections.set(request.cookies.sessionId, session);
        return session;
    }
}

const elastic = new Client({
    node: 'http://194.113.75.117:19200'
  })

const sendUpdate = async (update, id) => {
    const event = `event: update\ndata:${JSON.stringify(update)}\n\n`
    activeDocuments.get(id).clients.forEach((stream) => {
        stream.raw.write(event);
    })
}

const sendPresenceUpdate = async (update, id) => {
    const event = `event: presence\ndata:${JSON.stringify(update)}\n\n`
    activeDocuments.get(id).clients.forEach((stream) => {
	    stream.raw.write(event);
    })
}

const updateTopTen = async (id) => {
    http.get(`http://194.113.74.245:3000/${id}`);
    return;
}

const updateDocument = async (id) => {
    updateTopTen(id);
    const queue = activeDocuments.get(id).queue
    if(queue === null) {
        return;
    }
    const document = activeDocuments.get(id)
    document.ydoc.transact(() => {
        queue.forEach(update => Y.applyUpdate(document.ydoc, new Uint8Array(update)))
    })
    const response = await elastic.index({
        index: 'documents',
        id: id,
        document: {
            name: document.name,
            text: document.ydoc.getText("quill").toString()
        }
    });
    activeDocuments.get(id).queue = null;
}

app.post('/api/op/:id', async (request, reply) => {
    const update = request.body.data;
    const id = request.params.id;
    if(activeDocuments.get(id).queue === null) {
        activeDocuments.get(id).queue = [update];
        setTimeout(updateDocument, timeout, id);
    } else {
        activeDocuments.get(id).queue.push(update)
    }
    sendUpdate(update, id);
    reply.send({"status":"OK"});
})

//{ session_id, name, cursor: { index, length } }.
app.post('/api/presence/:id', async (request, reply) => {
    const session = await authenticate(request);
    const update = request.body;
    const id = request.params.id;
    const pres_update = {session_id:session.sessionId, name: session.name, cursor: {
        index: update.index,
        length: update.length
    }}
    activeDocuments.get(id).presence.set(session.sessionId, pres_update)
    sendPresenceUpdate(pres_update, id)
    reply.send({"status":"OK"});
})

const streamCurrentPresence = (stream, id) => {
	for (let [key, value] of activeDocuments.get(id).presence) {
		const event = `event: presence\ndata:${JSON.stringify(value)}\n\n`
		stream.raw.write(event);
	}
}

app.get(`/api/connect/:id`, async (request, reply) => {
    const session = await authenticate(request)
    if (!(session)) {
        reply.send({"error": true, "message": "Not logged in"});
        return;
    } else {
        const id = request.params.id;
        reply.hijack()
        reply.raw.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Connection': 'keep-alive',
            'Cache-Control': 'no-cache,no-transform',
            "x-no-compression": 1
        });         /* Set up SSE */
        let sync;
        if (activeDocuments.has(id)) { /* document already in memory */
            await updateDocument(id);
            sync = Array.from(Y.encodeStateAsUpdate(activeDocuments.get(id).ydoc)); // Could use V2 for sync
            activeDocuments.get(id).clients.add(reply);
        } else { /* load from DB */
            const ydoc = await prisma.document.findUnique({
                where: {
                    id: id.slice(2)
                }
            })
            if (ydoc == null) {
                reply.send({"error": true, "message": "Document doesnt exist"});
                return;
            } else {
                sync = new Uint8Array(ydoc.update);
                const load_doc = new Y.Doc();
                Y.applyUpdate(load_doc, sync); // Binary Test
                sync = Array.from(sync)
                let newSet = new Set();
                newSet.add(reply);
                const temp_obj = {
                    presence: new Map(),
                    ydoc: load_doc,
                    clients: newSet,
                    queue: null,
                    name: ydoc.name
                }
                activeDocuments.set(id, temp_obj);
            }
        }
        // if (clientConnections.has(request.cookies.sessionId)) {
        //     clientConnections.get(request.cookies.sessionId).add(reply);
        // } else {
        //     const clientCtxs = new Set();
        //     clientCtxs.add(reply);
        //     clientConnections.set(request.cookies.sessionId, clientCtxs);
        // } // .socket.on('close') reply.raw.on("close"
        request.socket.on("close", async () => {      /*  On close, remove from list of active clients */
            // console.log("ctx closed")
            // clientConnections.get(request.cookies.sessionId).delete(reply);
    	    activeDocuments.get(id).clients.delete(reply);
            activeDocuments.get(id).presence.delete(session.sessionId)
    	    const pres_update = {session_id:session.sessionId, name: session.name, cursor: {}}
       	    sendPresenceUpdate(pres_update, id)
            // if (docObj.clients.size === 0) {
            //     await prisma.document.update({
            //         where: {
            //             id: id.slice(1)
            //         },
            //         data: {
            //             update: Buffer.from(Y.encodeStateAsUpdate(activeDocuments.get(id).ydoc)) //V2 For sync
            //         }
            //     })
                // activeDocuments.get(id).ydoc.destroy();
                // activeDocuments.delete(id);
            // }
        });
        const pres_update = {session_id:session.sessionId, name: session.name, cursor: {
            index: 0,
            length: 0
        }}
        activeDocuments.get(id).presence.set(session.sessionId, pres_update)
        sendPresenceUpdate(pres_update, id)
        reply.raw.write(`event: sync\ndata:${JSON.stringify(sync)}\n\n`);
        streamCurrentPresence(reply, id);
    }
})

const start = async () => {
    try {
        await app.listen({ port: process.env.port, host:"0.0.0.0" })
    } catch (err) {
        app.log.error(err)
    }
}
start()


