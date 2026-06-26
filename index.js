const dns = require('node:dns');
dns.setServers(['1.1.1.1', '1.0.0.1']); 

const express = require('express');
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const cors = require("cors");
dotenv.config();

const app = express();

// 💡 মিডলওয়্যার সমূহ
app.use(cors());
app.use(express.json()); // 👈 এই লাইনটি অবশ্যই লাগবে, তা না হলে req.body খালি আসবে!

const port = process.env.NEXT_PUBLIC_SERVER_URL || 8085;
const uri = process.env.MONGO_DB_URI;

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
    const db = client.db("medicare_db");
    const subscriptionCollection = db.collection("subscription");
    const userCollection = db.collection('user');

    app.post("/subscription", async (req, res) => {
      try {
        const { sessionId, userId, priceId } = req.body;

        const isExist = await subscriptionCollection.findOne({sessionId})

        if(isExist){
          return res.json({message:"Already IsExist"})
        }

        // ভ্যালিডেশন চেক
        if (!userId) {
          return res.status(400).json({ error: "userId is required" });
        }

        // ১. সাবস্ক্রিপশন কালেকশনে ডাটা ইনসার্ট
        await subscriptionCollection.insertOne({
          sessionId,
          userId,
          priceId,
          createdAt: new Date()
        });

        // ২. ইউজারের রোল আপডেট করে 'pro' করা
        await userCollection.updateOne(
          { _id: new ObjectId(userId) },
          { $set: { plan: 'pro' } }
        );

        res.json({ massage: "Payment SuccessFull" });
      } catch (error) {
        console.error("Error updating subscription:", error);
        res.status(500).json({ error: error.message });
      }
    });

    // async function run() এর ভেতর কালেকশন ডিক্লেয়ার করুন
const bookingsCollection = db.collection("bookings");

// 📥 ১. বুকিং ডেটা সংরক্ষণ করার এন্ডপয়েন্ট
app.post("/api/bookings", async (req, res) => {
  try {
    const booking = req.body;

    // একই স্লটে একই ডাক্তারের ডুপ্লিকেট বুকিং এড়ানোর জন্য চেক
    const isExist = await bookingsCollection.findOne({
      userEmail: booking.userEmail,
      date: booking.date,
      time: booking.time,
      doctorName: booking.doctorName
    });

    if (isExist) {
      return res.json({ message: "Appointment already saved", success: true });
    }

    const result = await bookingsCollection.insertOne({
      ...booking,
      status: "Confirmed",
      createdAt: new Date()
    });

    res.status(201).json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 📤 ২. নির্দিষ্ট ইউজারের ইমেইল অনুযায়ী সব বুকিং গেট করার এন্ডপয়েন্ট
app.get("/api/bookings", async (req, res) => {
  try {
    const email = req.query.email;
    if (!email) {
      return res.status(400).json({ error: "User email is required" });
    }

    const result = await bookingsCollection
      .find({ userEmail: email })
      .sort({ createdAt: -1 })
      .toArray();

    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ❌ ৩. অ্যাপয়েন্টমেন্ট বাতিল বা ডিলিট করার এন্ডপয়েন্ট
app.delete("/api/bookings/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const result = await bookingsCollection.deleteOne({ _id: new ObjectId(id) });
    
    if (result.deletedCount === 1) {
      res.json({ success: true, message: "Appointment canceled successfully" });
    } else {
      res.status(404).json({ error: "Appointment not found" });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } catch (error) {
    console.error("Database connection error:", error);
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Hello World!');
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});