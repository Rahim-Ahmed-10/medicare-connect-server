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
          { $set: { role: 'pro' } }
        );

        res.json({ massage: "Payment SuccessFull" });
      } catch (error) {
        console.error("Error updating subscription:", error);
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