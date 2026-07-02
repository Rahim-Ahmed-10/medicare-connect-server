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
app.use(express.json()); // req.body হ্যান্ডেল করার জন্য

// 🎯 পোর্ট কনফিগারেশন ঠিক করা হলো
const port = process.env.PORT || 8085;
const uri = process.env.MONGO_DB_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

// 🌍 গ্লোবাল কালেকশন ভ্যারিয়েবল ডিক্লেয়ারেশন (যাতে সব রাউট অ্যাক্সেস পায়)
let subscriptionCollection;
let userCollection;
let bookingsCollection;
let reviewsCollection;
let prescriptionCollection;

const JWKS = createRemoteJWKSet(new URL(`${process.env.BETTER_AUTH_URL}/api/auth/jwks`))

const verifyToken = async (req, res, next) => {
  const authHeaders = req.headers.Authorization;

  if(!authHeaders || !authHeaders.startsWith("Bearer")){
    return res.status(401).json({message:"Unauthorized"})
  }

  const token = authHeaders.split(" ")[1]

  if(!token){
     return res.status(401).json({message:"Unauthorized"})   
  }

  try{
    const {payload} = await jwtVerify(token, JWKS)
    console.log(payload)
    next();
  }catch(error){
    console.log(error)
     return res.status(401).json({message:"Unauthorized"}) 
  }
}

async function run() {
  try {
    // await client.connect();
    const db = client.db("medicare_db");
    
    // কালেকশন ইনিশিয়ালাইজেশন
    subscriptionCollection = db.collection("subscription");
    userCollection = db.collection('user');
    bookingsCollection = db.collection("bookings");
    reviewsCollection = db.collection("reviews");
    doctorCollection = db.collection("doctors");
    paymentsCollection = db.collection("payments");
    // run() ফাংশনের ভেতরে:
prescriptionCollection = db.collection("prescriptions");

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
    // 📥 বুকিং ডেটা সংরক্ষণ (রোগীর দিক থেকে)
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
    // 📤 নির্দিষ্ট রোগীর বুকিং গেট করার এন্ডপয়েন্ট (Email ভিত্তিক)
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

  app.get("/api/admin/dashboard-stats", async (req, res) => {
  try {
    // ১. মূল স্ট্যাটাসসমূহ
    const totalPatients = await userCollection.countDocuments({ role: 'patient' });
    const totalClinicians = await userCollection.countDocuments({ role: 'doctor' });
    const totalBookings = await bookingsCollection.countDocuments({});
    
    // ২. মোট রেভিনিউ
    const revenueData = await bookingsCollection.aggregate([
      { $group: { _id: null, total: { $sum: { $toDouble: "$amount" } } } }
    ]).toArray();
    const totalRevenue = revenueData.length > 0 ? revenueData[0].total : 0;

    // ৩. ডক্টর পারফরম্যান্স (রেটিং)
    const ratingData = await reviewsCollection.find({}).toArray();

    // ৪. স্পেশালিটি ব্রেকডাউন (Specialty Breakdown)
    const specialtyData = await bookingsCollection.aggregate([
      { $group: { _id: "$specialty", count: { $sum: 1 } } }
    ]).toArray();

    // ৫. অ্যাপয়েন্টমেন্ট টাইমলাইন (Last 7 Days)
    const timelineData = await bookingsCollection.aggregate([
      { $group: { _id: "$date", count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]).toArray();

    res.json({ 
      totalPatients, 
      totalClinicians, 
      totalBookings, 
      totalRevenue,
      ratingData,
      specialtyData,
      timelineData
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ইউজার সাসপেন্ড করা (Status update)
app.patch("/api/users/suspend/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const filter = { _id: new ObjectId(id) };
    const updateDoc = {
      $set: { status: "suspended" },
    };
    const result = await userCollection.updateOne(filter, updateDoc);
    res.send(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ইউজার ডিলিট করা
app.delete("/api/users/delete/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const result = await userCollection.deleteOne(query);
    res.send(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// সব ইউজার নিয়ে আসা (GET Request)
app.get("/api/users", async (req, res) => {
  try {
    const users = await userCollection.find({}).toArray();
    res.send(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/doctors", async (req, res) => {
    try {
        const doctors = await doctorCollection.find({}).toArray();
        res.json(doctors);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


// স্ট্যাটাস আপডেট API 
app.patch("/api/doctors/:action/:id", async (req, res) => {
    try {
        const { action, id } = req.params;
        const statusMap = { 'approve': 'Verified', 'cancel': 'Pending', 'reject': 'Rejected' };
        
        const result = await doctorCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { verificationStatus: statusMap[action] } } // ডাটাবেজে এটি নতুন ফিল্ড হিসেবে যোগ হবে
        );
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get("/api/payments", async (req, res) => {
    try {
        // এখানে db এর পরিবর্তে সরাসরি paymentsCollection ব্যবহার করুন
        const payments = await paymentsCollection.find({}).toArray();
        res.json(payments);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

    // ==========================================
    // 🏥 ডক্টরের ড্যাশবোর্ডের বুকিং ডাটা গেট করার এন্ডপয়েন্ট (Name ভিত্তিক)
    // ==========================================
    app.get('/api/doctor/bookings', async (req, res) => {
        try {
            const { doctorName } = req.query; 
            let query = {};
            if (doctorName) {
                query = { doctorName: doctorName }; 
            }
            const result = await bookingsCollection.find(query).toArray();
            res.send({ success: true, data: result });
        } catch (error) {
            res.status(500).send({ success: false, message: error.message });
        }
    });

    // ==========================================
    // ❌ অ্যাপয়েন্টমেন্ট বাতিল করার এন্ডপয়েন্ট
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
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // ==========================================
    // 📥 রোগীর রিভিউ সাবমিট করার এন্ডপয়েন্ট
    // ==========================================
    app.post("/api/reviews/submit", async (req, res) => {
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
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // ==========================================
    // ⭐ ডক্টরের ড্যাশবোর্ডের রিভিউ ডাটা গেট করার এন্ডপয়েন্ট (Name ভিত্তিক)
    // ==========================================
    app.get('/api/doctor/reviews', async (req, res) => {
        try {
            const { doctorName } = req.query;
            let query = {};
            if (doctorName) {
                query = { doctorName: doctorName };
            }
            const result = await reviewsCollection.find(query).toArray();
            res.send({ success: true, data: result });
        } catch (error) {
            res.status(500).send({ success: false, message: error.message });
        }
    });

    
// ==========================================
// ✅ অ্যাপয়েন্টমেন্ট স্ট্যাটাস আপডেট (Pending/Accepted/Completed)
// ==========================================
app.patch("/api/bookings/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const { status } = req.body; // রিকোয়েস্ট বডি থেকে নতুন স্ট্যাটাস

    const filter = { _id: new ObjectId(id) };
    const updateDoc = {
      $set: {
        status: status, // যেমন: "Accepted" বা "Completed"
      },
    };

    const result = await bookingsCollection.updateOne(filter, updateDoc);

    if (result.modifiedCount > 0) {
      res.json({ success: true, message: "Status updated successfully" });
    } else {
      res.status(404).json({ success: false, message: "Booking not found or status unchanged" });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/prescriptions", async (req, res) => {
  try {
    // prescriptionCollection টি আগে ডিক্লেয়ার করা থাকতে হবে
    const allPrescriptions = await prescriptionCollection.find().toArray();
    res.json({ success: true, data: allPrescriptions });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// 🏥 প্রেসক্রিপশন সেভ করার এন্ডপয়েন্ট
// ==========================================
app.post("/api/prescriptions", async (req, res) => {
  try {
    // ফ্রন্টএন্ড থেকে পাঠানো ডাটা এখানে ঠিকমতো রিসিভ হচ্ছে কি না চেক করুন
    const { bookingId, patientName, doctorName, diagnosis, meds, notes } = req.body;

    const newPrescription = {
      bookingId,
      patientName,   // এটি যদি undefined আসে, তবে ডাটাবেসে সেভ হবে না
      doctorName,    // এটি যদি undefined আসে, তবে ডাটাবেসে সেভ হবে না
      diagnosis,
      meds,
      notes,
      createdAt: new Date()
    };

    const result = await prescriptionCollection.insertOne(newPrescription);
    res.status(201).json({ success: true, insertedId: result.insertedId });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/bookings/:id", async (req, res) => {
    try {
        const id = req.params.id;
        const booking = await bookingsCollection.findOne({ _id: new ObjectId(id) });
        if (!booking) return res.status(404).json({ message: "Booking not found" });
        res.json({ success: true, data: booking });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// app.get("/api/doctor/profile", async (req, res) => {
//     try {
//         const email = req.query.email; // ফ্রন্টএন্ড থেকে পাঠানো ইমেইল
//         const doctor = await userCollection.findOne({ email: email, role: 'doctor' });
//         if (!doctor) return res.status(404).json({ success: false, message: "No profile found" });
//         res.json({ success: true, data: doctor });
//     } catch (error) {
//         res.status(500).json({ error: error.message });
//     }
// });

app.get("/api/doctor/profile", async (req, res) => {
    try {
        const { email } = req.query;
        // আপনার ডাটাবেস কালেকশনের নাম 'account' বা 'users' যা ব্যবহার করছেন তা দিন
        const doctor = await accountCollection.findOne({ email: email }); 
        
        if (!doctor) {
            return res.status(404).json({ success: false, message: "Profile not found" });
        }
        res.json({ success: true, data: doctor });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
// ১. বুকিং আইডি দিয়ে ডাটা খোঁজার রাউট (এটি না থাকলে পেজে ডাটা আসবে না)
app.get("/api/bookings/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const booking = await bookingsCollection.findOne({ _id: new ObjectId(id) });
    if (!booking) return res.status(404).json({ message: "Not found" });
    res.json({ success: true, data: booking });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ২. প্রেসক্রিপশন সেভ করার রাউট (এখানে বুকিং স্ট্যাটাস আপডেট লজিক যোগ করা হয়েছে)
app.post("/api/prescriptions", async (req, res) => {
  try {
    const { bookingId, patientName, doctorName, diagnosis, meds, notes } = req.body;
    
    // প্রেসক্রিপশন সেভ
    const result = await prescriptionCollection.insertOne({
      bookingId, patientName, doctorName, diagnosis, meds, notes, createdAt: new Date()
    });

    // বুকিং স্ট্যাটাস 'Completed' আপডেট
    await bookingsCollection.updateOne(
      { _id: new ObjectId(bookingId) },
      { $set: { status: "Completed" } }
    );

    res.status(201).json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
    // ==========================================
    // 📊 নির্দিষ্ট রোগীর মোট রিভিউর সংখ্যা গেট করার এন্ডপয়েন্ট
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

    // আপনার সার্ভার ফাইলের রিভিউ সেকশনে এটি যোগ করুন:
app.post("/api/reviews", async (req, res) => {
  try {
    const reviewData = req.body;
    // এখানে ডাটাবেসে সেভ করার লজিক
    const result = await reviewsCollection.insertOne({
      ...reviewData,
      createdAt: new Date()
    });
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

    // MongoDB Ping
    // await client.db("admin").command({ ping: 1 });
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