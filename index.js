const express = require('express')
const cors = require('cors')
require('dotenv').config()
const app = express()
const port = process.env.PORT || 8000

app.use(express.json())
app.use(cors())



const { MongoClient, ServerApiVersion } = require('mongodb');
const uri = process.env.MONGODB_URI;
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} ${res.statusCode} - ${duration}ms`);
    });
    next();
});
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});
async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();

        const database = client.db("librarydb");
        const roomsCollection = database.collection("users");


        app.get('/rooms', async (req, res) => {

            const result = await roomsCollection.find().sort({ _id: -1 }).limit(6).toArray();

            res.json(result)
        })

        app.get('/allrooms', async (req, res) => {
            const result = await roomsCollection.find().toArray();
            res.json(result);
        });
        app.post("/allrooms", async (req, res) => {
            const roomData = req.body;
            const result = await roomsCollection.insertOne(roomData);

            res.json(result);
        });
        app.get("/rooms/my-rooms/:userId", async (req, res) => {
            const userId = req.params.userId;
            const query={ createdBy: userId }
            const rooms = await roomsCollection
                .find(query)
                .toArray();

            res.json({ rooms });
        });
        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('Hello World!')
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})

