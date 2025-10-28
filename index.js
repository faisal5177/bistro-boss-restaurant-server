import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { MongoClient, ObjectId, ServerApiVersion } from 'mongodb';
import stripePkg from 'stripe';

dotenv.config();

const stripe = stripePkg(process.env.STRIPE_SECRET_KEY);
const app = express();
const port = process.env.PORT || 5000;

// ------------------ MIDDLEWARE ------------------
app.use(
  cors({
    origin: [
      'http://localhost:5173',


    ],
    credentials: true,
  })
);

app.use(express.json());

// ------------------ MONGO SETUP ------------------
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.8kzkr.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
});

// ------------------ VERIFY TOKEN ------------------
const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).send({ message: 'unauthorized access' });

  const token = authHeader.split(' ')[1];
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) return res.status(401).send({ message: 'unauthorized access' });
    req.decoded = decoded;
    next();
  });
};

// ------------------ VERIFY ADMIN ------------------
let userCollection;
const verifyAdmin = async (req, res, next) => {
  const email = req.decoded.email;
  const user = await userCollection.findOne({ email });
  if (user?.role !== 'admin') {
    return res.status(403).send({ message: 'forbidden access' });
  }
  next();
};

// ------------------ MAIN FUNCTION ------------------
async function run() {
  try {
    await client.connect();

    const db = client.db('bistroDB');
    const menuCollection = db.collection('menu');
    const cartCollection = db.collection('carts');
    const reviewCollection = db.collection('reviews');
    userCollection = db.collection('users');
    const paymentCollection = db.collection('payments');
    const bookingCollection = db.collection('bookings');

    // ---------------- JWT ----------------
    app.post('/jwt', async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
      res.send({ token });
    });

    // ---------------- USERS ----------------
    app.post('/users', async (req, res) => {
      const user = req.body;
      const existing = await userCollection.findOne({ email: user.email });
      if (existing) return res.send({ message: 'user already exists', insertedId: null });
      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    app.get('/users', verifyToken, verifyAdmin, async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });

    app.get('/users/admin/:email', verifyToken, async (req, res) => {
      const email = req.params.email;
      if (req.decoded.email !== email) return res.status(403).send({ message: 'forbidden access' });
      const user = await userCollection.findOne({ email });
      res.send({ admin: user?.role === 'admin' });
    });

    app.patch('/users/admin/:id', verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const result = await userCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { role: 'admin' } }
      );
      res.send(result);
    });

    app.delete('/users/:id', verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const result = await userCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // ---------------- MENU ----------------

    app.get('/menu', async (req, res) => {
      const result = await menuCollection.find().toArray();
      res.send(result);
    });


    app.post('/menu', verifyToken, verifyAdmin, async (req, res) => {
      const result = await menuCollection.insertOne(req.body);
      res.send(result);
    });


    app.get('/menu/:id', async (req, res) => {
      const result = await menuCollection.findOne({ _id: new ObjectId(req.params.id) });
      res.send(result);
    });

    app.patch('/menu/:id', verifyToken, verifyAdmin, async (req, res) => {
      const item = req.body;
      const filter = { _id: new ObjectId(req.params.id) };
      const updateDoc = {
        $set: {
          name: item.name,
          category: item.category,
          price: item.price,
          recipe: item.recipe,
          image: item.image,
        },
      };
      const result = await menuCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    app.delete('/menu/:id', verifyToken, verifyAdmin, async (req, res) => {
      const result = await menuCollection.deleteOne({ _id: new ObjectId(req.params.id) });
      res.send(result);
    });

    // ---------------- REVIEWS ----------------
    app.get('/reviews', async (req, res) => {
      const result = await reviewCollection.find().toArray();
      res.send(result);
    });

    app.post('/reviews', async (req, res) => {
      const review = req.body;
      if (!review.name || !review.details || !review.rating)
        return res.status(400).send({ error: 'Missing required fields' });

      const result = await reviewCollection.insertOne(review);
      res.status(201).send({ message: 'Review added', reviewId: result.insertedId });
    });

    // ---------------- CART ----------------
    app.get('/carts', verifyToken, async (req, res) => {
      const email = req.query.email;
      const result = await cartCollection.find({ email }).toArray();
      res.send(result);
    });

    app.post('/carts', verifyToken, async (req, res) => {
      const result = await cartCollection.insertOne({ ...req.body, status: 'Pending' });
      res.send(result);
    });


    app.delete('/carts/:id', verifyToken, async (req, res) => {
      const id = req.params.id;
      const userEmail = req.decoded.email;
      const cartItem = await cartCollection.findOne({ _id: new ObjectId(id) });

      if (!cartItem) return res.status(404).send({ message: 'Cart item not found' });
      const user = await userCollection.findOne({ email: userEmail });
      const isAdmin = user?.role === 'admin';
      const isOwner = cartItem.email === userEmail;

      if (!isAdmin && !isOwner)
        return res.status(403).send({ message: 'Forbidden: Not your item' });

      const result = await cartCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // ---------------- STRIPE PAYMENT ----------------
    app.post('/create-payment-intent', async (req, res) => {
      try {
        const { price } = req.body;
        if (!price || price <= 0) return res.status(400).send({ error: 'Invalid price' });

        const amount = Math.round(price * 100);

        const paymentIntent = await stripe.paymentIntents.create({
          amount,
          currency: 'usd',
          payment_method_types: ['card'],
        });

        res.send({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        console.error('Stripe error:', error);
        res.status(500).send({ error: 'Failed to create payment intent' });
      }
    });

    app.post('/payments', async (req, res) => {
      try {
        const { menuItemIds, cartIds, ...rest } = req.body;

        const payment = {
          ...rest,
          menuItemIds: menuItemIds.map(id => new ObjectId(id)),
          cartIds: cartIds.map(id => new ObjectId(id)),
        };

        const paymentResult = await paymentCollection.insertOne(payment);


        const deleteQuery = { _id: { $in: payment.cartIds } };
        const deleteResult = await cartCollection.deleteMany(deleteQuery);

        res.send({ paymentResult, deleteResult });
      } catch (error) {
        console.error('Error saving payment:', error);
        res.status(500).send({ error: 'Payment failed to save' });
      }

    });

    app.get('/payments/:email', verifyToken, async (req, res) => {
      const email = req.params.email;
      if (email !== req.decoded.email)
        return res.status(403).send({ message: 'forbidden access' });
      const result = await paymentCollection.find({ email }).toArray();
      res.send(result);
    });

    // ---------------- ADMIN STATS ----------------
    app.get('/admin-stats', verifyToken, verifyAdmin, async (req, res) => {
      const users = await userCollection.estimatedDocumentCount();
      const menuItems = await menuCollection.estimatedDocumentCount();
      const orders = await paymentCollection.estimatedDocumentCount();

      const revenueData = await paymentCollection.aggregate([
        { $group: { _id: null, totalRevenue: { $sum: '$price' } } },
      ]).toArray();
      const revenue = revenueData.length > 0 ? revenueData[0].totalRevenue : 0;

      res.send({ users, menuItems, orders, revenue });
    });

    // ---------------- ORDER STATS ----------------
    app.get('/order-stats', verifyToken, verifyAdmin, async (req, res) => {
      const result = await paymentCollection.aggregate([
        { $unwind: '$menuItemIds' },
        {
          $lookup: {
            from: 'menu',
            localField: 'menuItemIds',
            foreignField: '_id',
            as: 'menuItems',
          },
        },
        { $unwind: '$menuItems' },
        {
          $group: {
            _id: '$menuItems.category',
            quantity: { $sum: 1 },
            revenue: { $sum: '$menuItems.price' },
          },
        },
        {
          $project: {
            _id: 0,
            category: '$_id',
            quantity: 1,
            revenue: 1,
          },
        },
      ]).toArray();

      res.send(result);

    });


    // ---------------- ROOT ----------------
    app.get('/', (req, res) => {
      res.send(' Bistro Boss Server is running successfully on Vercel!');
    });

    console.log(' MongoDB connected successfully!');
  } finally {
    // keep connection open for serverless
  }
}

// ------------------ START SERVER ------------------

run().catch(console.dir);

//  Export app for Vercel
export default app;

//  Local run (optional)
if (process.env.NODE_ENV !== 'production') {
  app.listen(port, () => console.log(` Bistro Boss running on port: ${port}`));
}
