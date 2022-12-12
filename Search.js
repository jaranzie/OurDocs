const fastify = require('fastify');
const fastifyCookie = require('@fastify/cookie');
const { Client } = require('@elastic/elasticsearch');
const cluster = require('cluster');
const numCPUs = require('os').cpus().length;

const ElasticAddress = 'http://194.113.75.117:19200';
let client;

const app = fastify({});

app.get(`/index/search`, async (request, reply) => {
  const query = request.query.q
  const result = await client.search({
    index: "documents",
    query: {
      match: {
          query: query
      }
    },
    highlight: {
      boundary_chars: ".,!?",
      boundary_scanner: "sentence",
      fields: {
          text: {"type": "unified","fragment_size": 150, "number_of_fragments": 1, "fragmenter": "span"}
      }
    }
  })

  const replyRes = []
  for (res of result.hits.hits) {
    const snippet = res.highlight[0]
    replyRes.push({
      docid: res._id,
      name: res._source.name,
      snippet: snippet
    })
  }
  reply.send(replyRes);
})


// app.get(`/index/suggest`, async (request, reply) => {
//   const query = request.query.q
  
//   const result = await client.search({
//     index: "documents",
//     suggest: {
//       suggestion: {
//         text: query,
//         term: {
//           field: 'text'
//         }
//       }
//     }
//   })
//   const replyRes = [];
//   const querylen = query.length;
//   for (sug of result.suggest.suggestion) {
//     if(sug.options.text.length > querylen) {
//       replyRes.push(sug.options.text.length)
//     }
//   }
//   reply.send(replyRes);
// })



const result = await client.search({
  index: "documents",
  query: {
    prefix: {
        query: query
    }
  }
})



app.get(`/index/suggest`, async (request, reply) => {
  const query = request.query.q
  const result = await client.search({
    index: "documents",
    suggest: {
      suggestion: {
        text: query,
        term: {
          field: 'text'
        }
      }
    }
  })
  const replyRes = [];
  const querylen = query.length;
  for (sug of result.suggest.suggestion[0].options) {
    if(sug.text.length > querylen) {
      replyRes.push(sug.text)
    }
  }
  reply.send(replyRes);
})



const start = async () => {
  try {
      await fastify.listen({ port: 6969, host: "0.0.0.0" })
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
  client = new Client({
    node: ElasticAddress
  })
  start();
}


if (cluster.isMaster) {
  masterProcess();
} else {
  childProcess();
}



app.get(`/index/suggest`, async (request, reply) => {
  const query = request.query.q
 // const result = await client.search({
//    index: "documents",
//    suggest: {
//      suggestion: {
//        text: query,
//        term: {
//          field: 'text'
//        }
//      }
//    }

//  })
        //
        //
        //
        const result = await client.search({
  index: "documents",
  query: {
    prefix: {
        text: query
    }},
        highlight: {
                pre_tags: [""],
                post_tags: [""],
                boundary_scanner: "word",
        fields: {
        text: {"type": "unified","fragment_size": 0, "number_of_fragments": 1, "fragmenter": "span"}

        }
        }
})

        console.log(result.hits.hits[0].highlight.text[0])
        //console.log(result.suggest.suggestion[0].options)
  const replyRes = [];
  const querylen = query.length;
        console.log(result.suggest.suggestion[0])
  for (sug of result.suggest.suggestion[0].options) {
    if(sug.text.length > querylen) {
      replyRes.push(sug.text)
    }
  }
  reply.send(replyRes);
})