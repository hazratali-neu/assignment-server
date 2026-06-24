const express = require('express')
const cors = require('cors')
require('dotenv').config()
const app = express()
const port = process.env.PORT || 8000
const { ObjectId } = require("mongodb");


app.use(express.json())
app.use(cors())

const { MongoClient, ServerApiVersion } = require('mongodb');
const uri = process.env.MONGODB_URI;

// Request Logger
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
        await client.connect();

        const database = client.db("librarydb");
        const roomsCollection = database.collection("users"); 
        const bookingsCollection = database.collection("bookings"); 

        // ----------------------------------------------------------------
        // ROOMS API ENDPOINTS
        // ----------------------------------------------------------------
        app.get('/rooms', async (req, res) => {
            const result = await roomsCollection.find().sort({ _id: -1 }).limit(6).toArray();
            res.json(result)
        })

       
        app.get('/allrooms', async (req, res) => {
            try {
                const { search, amenities } = req.query;
                let query = {};

                if (search) {
                    query.name = { $regex: search, $options: "i" };
                }

                if (amenities) {
                    const amenitiesArray = amenities.split(",");
                    query.amenities = { $all: amenitiesArray }; 
                }

                const result = await roomsCollection.find(query).toArray();
                res.json(result);
            } catch (err) {
                res.status(500).json({ error: "Internal Server Error: " + err.message });
            }
        });

        app.post("/allrooms", async (req, res) => {
            const roomData = req.body;
            const result = await roomsCollection.insertOne(roomData);
            res.json(result);
        });

        app.delete("/allrooms/:id", async (req, res) => {
            const id = req.params.id;
            const result = await roomsCollection.deleteOne({ _id: new ObjectId(id) });
            res.json(result);
        });
        app.patch("/allrooms/:id", async (req, res) => {
            try {
                const id = req.params.id;
                const { userId, ...updatedFields } = req.body;

             
                const room = await roomsCollection.findOne({ _id: new ObjectId(id) });
                if (!room) {
                    return res.status(404).json({ error: "Room not found" });
                }

              
                if (room.createdBy !== userId) {
                    return res.status(403).json({ error: "Unauthorized: Only the owner can update this room" });
                }

                if (updatedFields.capacity !== undefined) updatedFields.capacity = Number(updatedFields.capacity);
                if (updatedFields.hourlyRate !== undefined) updatedFields.hourlyRate = Number(updatedFields.hourlyRate);
                if (updatedFields.totalSlot !== undefined) updatedFields.totalSlot = Number(updatedFields.totalSlot);

          
                const result = await roomsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: updatedFields }
                );

                res.json({ success: true, message: "Room updated successfully" });
            } catch (err) {
                res.status(500).json({ error: "Internal Server Error: " + err.message });
            }
        });

        app.get("/rooms/my-rooms/:userId", async (req, res) => {
            const userId = req.params.userId;
            const query = { createdBy: userId }
            const rooms = await roomsCollection.find(query).toArray();
            res.json({ rooms });
        });

        app.get("/rooms/:id", async (req, res) => {
            const id = req.params.id;
            const room = await roomsCollection.findOne({ _id: new ObjectId(id) });
            res.json(room);
        });
  

        app.get("/my-bookings/:userId", async (req, res) => {
            try {
                const userId = req.params.userId;

              
                const bookings = await database.collection("bookings")
                    .find({ userId: userId })
                    .sort({ createdAt: -1 })
                    .toArray();

                // ২. প্রতিটি বুকিংয়ের সাথে রুমের নাম এবং ইমেজ যুক্ত (Populate) করা
                const populatedBookings = await Promise.all(
                    bookings.map(async (booking) => {
                        let roomInfo = null;
                        try {
                            // আপনার রিকোয়ারমেন্ট অনুযায়ী রুমগুলো "users" কালেকশনে আছে
                            roomInfo = await database.collection("users").findOne({
                                _id: new ObjectId(booking.roomId)
                            });
                        } catch (e) {
                            console.log("Room details fetch error:", e.message);
                        }

                        return {
                            ...booking,
                            roomName: roomInfo ? roomInfo.name : "Unknown Room",
                            roomImage: roomInfo ? roomInfo.image : "https://images.unsplash.com/photo-1497366216548-37526070297c"
                        };
                    })
                );

                res.json(populatedBookings);
            } catch (err) {
                res.status(500).json({ error: "Internal Server Error: " + err.message });
            }
        });

        // ----------------------------------------------------------------
        // CANCEL BOOKING ENDPOINT
        // ----------------------------------------------------------------
        app.patch("/bookings/cancel/:id", async (req, res) => {
            try {
                const bookingId = req.params.id;

                const result = await database.collection("bookings").updateOne(
                    { _id: new ObjectId(bookingId) },
                    { $set: { status: "cancelled" } }
                );

                if (result.modifiedCount === 0) {
                    return res.status(404).json({ error: "Booking not found or already cancelled." });
                }

                res.json({ success: true, message: "Booking cancelled successfully!" });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });
        // ----------------------------------------------------------------
        // BOOKING CONFIRMATION API (With Advanced Conflict Check)
        // ----------------------------------------------------------------
        app.post("/bookings", async (req, res) => {
            try {
                const { roomId, userId, date, startTime, endTime, totalCost, specialNote } = req.body;

                if (!roomId || !userId || !date || !startTime || !endTime) {
                    return res.status(400).json({ error: "Missing required booking details." });
                }

                // স্ট্রিং টাইমকে ক্যালকুলেশনের সুবিধার জন্য ইন্টিজারে রূপান্তর (e.g., "08:00" -> 8)
                const newStart = parseInt(startTime.split(":")[0]);
                const newEnd = parseInt(endTime.split(":")[0]);

                // ওভারল্যাপিং কনফ্লিক্ট চেক অ্যালগরিদম
                const conflictBooking = await bookingsCollection.findOne({
                    roomId: roomId,
                    date: date,
                    $or: [
                        {
                            // কন্ডিশন ১: পুরাতন বুকিং চলাকালীন নতুন বুকিং শুরু হলে
                            startHour: { $lte: newStart },
                            endHour: { $gt: newStart }
                        },
                        {
                            // কন্ডিশন ২: পুরাতন বুকিং শেষ হওয়ার আগে নতুন বুকিং শেষ হলে
                            startHour: { $lt: newEnd },
                            endHour: { $gte: newEnd }
                        },
                        {
                            // কন্ডিশন ৩: নতুন বুকিং পুরাতন স্লটকে সম্পূর্ণ ওভারল্যাপ করলে
                            startHour: { $gte: newStart },
                            endHour: { $lte: newEnd }
                        }
                    ]
                });

                if (conflictBooking) {
                    return res.status(409).json({
                        error: "This time slot is already booked for the selected date. Please choose another time!"
                    });
                }

                // নতুন বুকিং অবজেক্ট ডকুমেন্ট
                const bookingDoc = {
                    roomId,
                    userId,
                    date,
                    startTime,
                    endTime,
                    startHour: newStart,
                    endHour: newEnd,
                    totalCost,
                    specialNote: specialNote || "",
                    createdAt: new Date()
                };

                // ১. বুকিং কালেকশনে ডাটা ইনসার্ট
                const bookingResult = await bookingsCollection.insertOne(bookingDoc);

                // ২. রুমের (যা users কালেকশনে আছে) bookingCount ১ বাড়িয়ে দেওয়া
                await roomsCollection.updateOne(
                    { _id: new ObjectId(roomId) },
                    { $inc: { bookingCount: 1 } }
                );

                res.status(201).json({
                    success: true,
                    message: "Room booked successfully!",
                    bookingId: bookingResult.insertedId
                });

            } catch (err) {
                res.status(500).json({ error: "Internal Server Error: " + err.message });
            }
        });

        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } catch (err) {
        console.error(err);
    }
}
run().catch(console.dir);

// app.get('/', (req, res) => {
//     res.send('Hello World!')
// })

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})