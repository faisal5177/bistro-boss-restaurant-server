const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB URI
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.8kzkr.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Declare collections globally
let menuCollection;
let cartCollection;
let reviewCollection;
let userCollection;

// JWT Middleware
const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send({ message: 'unauthorized access' });
  }

  const token = authHeader.split(' ')[1];
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: 'unauthorized access' });
    }
    req.decoded = decoded;
    next();
  });
};

// Verify Admin Middleware
const verifyAdmin = async (req, res, next) => {
  const email = req.decoded.email;
  const user = await userCollection.findOne({ email });
  if (user?.role !== 'admin') {
    return res.status(403).send({ message: 'forbidden access' });
  }
  next();
};

async function run() {
  try {
    await client.connect();
    const database = client.db('bistroDB');
    menuCollection = database.collection('menu');
    cartCollection = database.collection('Carts');
    reviewCollection = database.collection('reviews');
    userCollection = database.collection('users');
    bookingCollection = database.collection('bookings');

    // ---------------- JWT ----------------
    app.post('/jwt', async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: '1h',
      });
      res.send({ token });
    });

    // ---------------- USERS ----------------
    app.post('/users', async (req, res) => {
      const user = req.body;
      const existing = await userCollection.findOne({ email: user.email });
      if (existing) {
        return res.send({ message: 'user already exists', insertedId: null });
      }
      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    app.get('/users', verifyToken, verifyAdmin, async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });

    app.get('/users/admin/:email', verifyToken, async (req, res) => {
      const email = req.params.email;
      if (req.decoded.email !== email) {
        return res.status(403).send({ message: 'forbidden access' });
      }
      const user = await userCollection.findOne({ email });
      res.send({ admin: user?.role === 'admin' });
    });

    app.patch(
      '/users/admin/:id',
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const updateDoc = { $set: { role: 'admin' } };
        const result = await userCollection.updateOne(filter, updateDoc);
        res.send(result);
      }
    );

    app.delete('/users/:id', verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const result = await userCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // ---------------- MENU ----------------
    // ✅ GET all menu items
    app.get('/menu', async (req, res) => {
      const result = await menuCollection.find().toArray();
      res.send(result);
    });

    // ✅ POST a new menu item (admin only)
    app.post('/menu', verifyToken, verifyAdmin, async (req, res) => {
      const item = req.body;
      const result = await menuCollection.insertOne(item);
      res.send(result);
    });

    // ✅ GET a single item by ID (for edit)
    app.get('/menu/:id', async (req, res) => {
      const id = req.params.id;
      const result = await menuCollection.findOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // ✅ DELETE a menu item (admin only)
    app.delete('/menu/:id', verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const result = await menuCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // ✅ PATCH to update a menu item (admin only)
    app.patch('/menu/:id', verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const updatedItem = req.body;

      const updateDoc = {
        $set: {
          name: updatedItem.name,
          category: updatedItem.category,
          price: parseFloat(updatedItem.price),
          image: updatedItem.image,
          recipe: updatedItem.recipe,
        },
      };

      const result = await menuCollection.updateOne(
        { _id: new ObjectId(id) },
        updateDoc
      );
      res.send(result);
    });

    // ---------------- REVIEWS ----------------
    app.get('/reviews', async (req, res) => {
      const result = await reviewCollection.find().toArray();
      res.send(result);
    });

    app.post('/reviews', async (req, res) => {
      const review = req.body;
      if (!review.name || !review.details || !review.rating) {
        return res.status(400).send({ error: 'Missing required fields' });
      }
      try {
        const result = await reviewCollection.insertOne(review);
        res
          .status(201)
          .send({ message: 'Review added', reviewId: result.insertedId });
      } catch (err) {
        console.error(err);
        res.status(500).send({ error: 'Failed to save review' });
      }
    });

    // --------------MY BOOKING--------------
    app.post('/bookings', async (req, res) => {
      const booking = req.body;
      const result = await bookingCollection.insertOne(booking);
      res.send(result);
    });

    app.get('/bookings', verifyToken, async (req, res) => {
      const email = req.query.email;
      if (!email || req.decoded.email !== email) {
        return res.status(403).send({ message: 'forbidden access' });
      }

      const result = await bookingCollection.find({ email }).toArray();
      res.send(result);
    });

    app.get('/admin/bookings', verifyToken, verifyAdmin, async (req, res) => {
      const result = await bookingCollection.find().toArray();
      res.send(result);
    });

    app.delete('/bookings/:id', verifyToken, async (req, res) => {
      const id = req.params.id;
      const userEmail = req.decoded.email;

      const booking = await bookingCollection.findOne({
        _id: new ObjectId(id),
      });
      const user = await userCollection.findOne({ email: userEmail });

      const isAdmin = user?.role === 'admin';
      const isOwner = booking?.email === userEmail;

      if (!isAdmin && !isOwner) {
        return res
          .status(403)
          .send({ message: 'Forbidden: Not allowed to delete' });
      }

      const result = await bookingCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    // ---------------- CART ----------------
    app.get('/cart', async (req, res) => {
      const email = req.query.email;
      const query = email ? { email } : {};
      const result = await cartCollection.find(query).toArray();
      res.send(result);
    });

    app.post('/carts', async (req, res) => {
      const cartItem = req.body;
      const result = await cartCollection.insertOne(cartItem);
      res.send(result);
    });

    //  Final, Secure DELETE Cart Route (with admin check)
    app.delete('/carts/:id', verifyToken, async (req, res) => {
      const id = req.params.id;
      const userEmail = req.decoded.email;

      try {
        const cartItem = await cartCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!cartItem) {
          return res.status(404).send({ message: 'Cart item not found' });
        }

        const user = await userCollection.findOne({ email: userEmail });
        const isAdmin = user?.role === 'admin';
        const isOwner = cartItem.email === userEmail;

        if (!isAdmin && !isOwner) {
          return res.status(403).send({ message: 'Forbidden: Not your item' });
        }

        const result = await cartCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: 'Failed to delete cart item' });
      }
    });

    // ---------------- TEST ROUTES ----------------
    app.get('/', (req, res) => {
      res.send('Boss is sitting');
    });

    app.get('/api/data', (req, res) => {
      res.json({ message: 'This is sample data from the API' });
    });

    // Test connection
    await client.db('admin').command({ ping: 1 });
    console.log(' Successfully connected to MongoDB!');
  } catch (error) {
    console.error(' MongoDB connection error:', error);
  }
}

run().catch(console.dir);

// Start Server
app.listen(port, () => {
  console.log(` Bistro boss is sitting on port ${port}`);
});
