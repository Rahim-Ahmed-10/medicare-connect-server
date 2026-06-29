const dns = require('node:dns');
dns.setServers(['1.1.1.1', '1.0.0.1']); 

const express = require('express');
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const cors = require("cors");
const { createRemoteJWKSet, jwtVerify } = require('jose-cjs');
dotenv.config();

const app = express();

// 💡 মিডলওয়্যার সমূহ
app.use(cors());
app.use(express.json()); // 👈 req.body হ্যান্ডেল করার জন্য এটি অত্যন্ত জরুরি

// 🎯 পোর্ট কনফিগারেশন ঠিক করা হলো (শুধুমাত্র সংখ্যা ৮MDg বা পরিবেশের পোর্ট নেবে)
const port = process.env.PORT || 8085;
const uri = process.env.MONGO_DB_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

const JWKS = createRemoteJWKSet(new URL(`${process.env.BETTER_AUTH_URL}/api/auth/jwks`))

const verifyToken = async (req, res, next) => {
  const authHeaders= req.headers.Authorization;

  if(!authHeaders || !authHeaders.startsWith("Bearer")){
    return res.status(401).json({massage:"Unauthorized"})
  }

  const token = authHeaders.split(" ")[1]

  if(!token){
     return res.status(401).json({massage:"Unauthorized"})   
  }

  try{
    const {payload} = await jwtVerify(token, JWKS)
    console.log(payload)

    next();

  }catch(error){
    console.log(error)
     return res.status(401).json({massage:"Unauthorized"}) 

  }
}

async function run() {
  try {
    await client.connect();
    const db = client.db("medicare_db");
    const subscriptionCollection = db.collection("subscription");
    const userCollection = db.collection('user');
    const bookingsCollection = db.collection("bookings");
    const reviewsCollection = db.collection("reviews");

    // ==========================================
    // 💳 সাবস্ক্রিপশন রাউট
    // ==========================================
    app.post("/subscription", async (req, res) => {
      try {
        const { sessionId, userId, priceId } = req.body;

        const isExist = await subscriptionCollection.findOne({ sessionId });

        if (isExist) {
          return res.json({ message: "Already IsExist" });
        }

        if (!userId) {
          return res.status(400).json({ error: "userId is required" });
        }

        await subscriptionCollection.insertOne({
          sessionId,
          userId,
          priceId,
          createdAt: new Date()
        });

        await userCollection.updateOne(
          { _id: new ObjectId(userId) },
          { $set: { plan: 'pro' } }
        );

        res.json({ message: "Payment Successful" });
      } catch (error) {
        console.error("Error updating subscription:", error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // ==========================================
    // 📥 বুকিং ডেটা সংরক্ষণ করার এন্ডপয়েন্ট
    // ==========================================
    app.post("/api/bookings", async (req, res) => {
      try {
        const booking = req.body;

        const isExist = await bookingsCollection.findOne({
          userEmail: booking.userEmail,
          date: booking.date,
          time: booking.time,
          doctorName: booking.doctorName,
          symptomsDescription: booking.symptomsDescription,
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
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // ==========================================
    // 📤 নির্দিষ্ট ইউজারের বুকিং গেট করার এন্ডপয়েন্ট
    // ==========================================
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
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // ==========================================
    // ❌ অ্যাপয়েন্টমেন্ট বাতিল বা ডিলিট করার এন্ডপয়েন্ট
    // ==========================================
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
        // 🎯 ডাইনামিক এরর মেসেজ ঠিক করা হলো
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // ==========================================
    // 📥 রোগীর রিভিউ সাবমিট বা সেভ করার এন্ডপয়েন্ট
    // ==========================================
    app.post("/api/reviews/submit",async (req, res) => {
      try {
        const reviewData = req.body;
        
        if (!reviewData.email || !reviewData.comment) {
          return res.status(400).json({ success: false, message: "Required fields missing." });
        }

        const result = await reviewsCollection.insertOne({
          ...reviewData,
          createdAt: new Date()
        });

        res.status(201).json({ success: true, data: result });
      } catch (error) {
        // 🎯 স্ট্রিং এরর ফিক্স করা হলো
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // ==========================================
    // 📊 নির্দিষ্ট ইউজারের মোট রিভিউর সংখ্যা গেট করার এন্ডপয়েন্ট
    // ==========================================
    app.get("/api/reviews/count", async (req, res) => {
      try {
        const email = req.query.email;
        if (!email) {
          return res.status(400).json({ success: false, error: "Email parameter is required" });
        }

        const totalReviews = await reviewsCollection.countDocuments({ email: email });
        res.json({ success: true, count: totalReviews });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // MongoDB Ping
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } catch (error) {
    console.error("Database connection error:", error);
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Medicare Connect Server is Running!');
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});