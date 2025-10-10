const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB URI
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.8kzkr.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// MongoDB Client
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Declare collection variable
let menuCollection;

async function run() {
  try {
    // Connect to MongoDB
    await client.connect();

    // Get the collection
    const database = client.db('bistroDB');
    menuCollection = database.collection('menu');
    reviewCollection = database.collection('reviews');

    app.get('/menu', async (req, res) => {
      const result = await menuCollection.find().toArray();
      res.send(result);
    });

    app.get('/reviews', async (req, res) => {
      const result = await reviewCollection.find().toArray();
      res.send(result);
    });

    // Test the connection
    await client.db('admin').command({ ping: 1 });
    console.log(' Successfully connected to MongoDB!');
  } catch (error) {
    console.error(' MongoDB connection error:', error);
  }
  // DO NOT close the client here — keep it connected
}

run().catch(console.dir);

// Routes
app.get('/', (req, res) => {
  res.send('Boss is sitting');
});

app.get('/api/data', (req, res) => {
  res.json({ message: 'This is sample data from the API' });
});

app.get('/menu', async (req, res) => {
  try {
    const result = await menuCollection.find().toArray();
    res.send(result);
  } catch (error) {
    console.error('Error fetching menu:', error);
    res.status(500).send({ error: 'Failed to fetch menu data' });
  }
});

// Start server
app.listen(port, () => {
  console.log(` Bistro boss is sitting on port ${port}`);
});
