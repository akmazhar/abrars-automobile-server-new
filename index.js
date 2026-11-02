const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;

// ========================================
// CONFIGURATION
// ========================================

const MONGODB_URI = process.env.MONGODB_URI;

const normalizeOrigin = (url) => url.trim().replace(/\/+$/, "");

const allowedOrigins = [
  "http://localhost:5173",
  "https://abrars-automobile.vercel.app",
  ...(process.env.CLIENT_URL
    ? process.env.CLIENT_URL.split(",").map(normalizeOrigin).filter(Boolean)
    : []),
].map(normalizeOrigin);

const client = new MongoClient(MONGODB_URI || "mongodb://127.0.0.1:27017", {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 10000,
});

// Database collections
let carCollection;
let myCartCollection;
let brandCollection;

let carDB;
let brandDB;

let connectionPromise = null;

// ========================================
// DATABASE CONNECTION
// ========================================

async function connectDB() {
  if (carCollection && myCartCollection && brandCollection) {
    return;
  }

  if (!MONGODB_URI) {
    throw new Error("MONGODB_URI is missing from environment variables.");
  }

  if (!connectionPromise) {
    connectionPromise = (async () => {
      await client.connect();

      carDB = client.db("carDB");
      brandDB = client.db("brandDB");

      // Correct MongoDB collection names
      carCollection = carDB.collection("cars");
      myCartCollection = carDB.collection("myCart");
      brandCollection = brandDB.collection("brands");

      await client.db("admin").command({ ping: 1 });

      console.log("MongoDB connected successfully.");
      console.log("Car collection: carDB.cars");
      console.log("Cart collection: carDB.myCart");
      console.log("Brand collection: brandDB.brands");
    })().catch((error) => {
      connectionPromise = null;
      carCollection = undefined;
      myCartCollection = undefined;
      brandCollection = undefined;
      carDB = undefined;
      brandDB = undefined;
      throw error;
    });
  }

  await connectionPromise;
}

// ========================================
// MIDDLEWARE
// ========================================

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(normalizeOrigin(origin))) {
        return callback(null, true);
      }

      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

app.use(express.json({ limit: "1mb" }));

// Connect MongoDB before API requests
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (error) {
    next(error);
  }
});

// ========================================
// HELPER FUNCTIONS
// ========================================

const isValidId = (id) => /^[0-9a-fA-F]{24}$/.test(id);

const getObjectId = (id) => {
  return isValidId(id) ? new ObjectId(id) : null;
};

const asyncHandler = (handler) => {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
};

const escapeRegex = (value) => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

const sanitizeDocument = (data) => {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }

  const sanitized = {};

  for (const [key, value] of Object.entries(data)) {
    if (
      key === "_id" ||
      key === "createdAt" ||
      key === "updatedAt" ||
      key.startsWith("$") ||
      key.includes(".")
    ) {
      continue;
    }

    sanitized[key] = value;
  }

  return sanitized;
};

// Supports both brandName and brand_name
const getBrandName = (car) => {
  return (car?.brandName || car?.brand_name || "").toString().trim();
};

// ========================================
// HOME & HEALTH ROUTES
// ========================================

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Abrars Automobile Server is running.",
  });
});

app.get(
  "/health",
  asyncHandler(async (req, res) => {
    await client.db("admin").command({ ping: 1 });

    res.status(200).json({
      success: true,
      database: "connected",
      message: "Server and MongoDB are healthy.",
    });
  }),
);

// ========================================
// DATABASE DIAGNOSTICS
// ========================================

// Check actual database and collection names.
// Useful for troubleshooting empty API responses.

app.get(
  "/diagnostics",
  asyncHandler(async (req, res) => {
    const carCollections = await carDB.listCollections().toArray();

    const brandCollections = await brandDB.listCollections().toArray();

    const carCount = await carCollection.countDocuments();
    const cartCount = await myCartCollection.countDocuments();
    const brandCount = await brandCollection.countDocuments();

    res.status(200).json({
      success: true,
      database: {
        carDatabase: "carDB",
        brandDatabase: "brandDB",
      },
      collections: {
        carDB: carCollections.map((item) => item.name),
        brandDB: brandCollections.map((item) => item.name),
      },
      documentCounts: {
        cars: carCount,
        myCart: cartCount,
        brands: brandCount,
      },
    });
  }),
);

// ========================================
// CAR ROUTES
// ========================================

// GET ALL CARS

app.get(
  "/car",
  asyncHandler(async (req, res) => {
    const cars = await carCollection.find({}).toArray();

    res.status(200).json(cars);
  }),
);

// GET SINGLE CAR

app.get(
  "/car/:id",
  asyncHandler(async (req, res) => {
    const id = getObjectId(req.params.id);

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Invalid car ID.",
      });
    }

    const car = await carCollection.findOne({ _id: id });

    if (!car) {
      return res.status(404).json({
        success: false,
        message: "Car not found.",
      });
    }

    res.status(200).json(car);
  }),
);

// GET PRODUCT DETAILS

app.get(
  "/product/:id",
  asyncHandler(async (req, res) => {
    const id = getObjectId(req.params.id);

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID.",
      });
    }

    const product = await carCollection.findOne({ _id: id });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found.",
      });
    }

    res.status(200).json(product);
  }),
);

// GET CARS BY BRAND
// Supports both brandName and brand_name fields.

app.get(
  "/brand/:brandName",
  asyncHandler(async (req, res) => {
    const brandName = req.params.brandName.trim();

    if (!brandName) {
      return res.status(400).json({
        success: false,
        message: "Brand name is required.",
      });
    }

    const brandRegex = {
      $regex: `^${escapeRegex(brandName)}$`,
      $options: "i",
    };

    const cars = await carCollection
      .find({
        $or: [{ brandName: brandRegex }, { brand_name: brandRegex }],
      })
      .toArray();

    res.status(200).json(cars);
  }),
);

// ADD NEW CAR

app.post(
  "/car",
  asyncHandler(async (req, res) => {
    const newCar = sanitizeDocument(req.body);

    if (!newCar || typeof newCar.name !== "string" || !newCar.name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Valid car name is required.",
      });
    }

    const brandName = getBrandName(newCar);

    if (!brandName) {
      return res.status(400).json({
        success: false,
        message: "Valid brand name is required.",
      });
    }

    const carData = {
      ...newCar,
      name: newCar.name.trim(),
      brandName,
      createdAt: new Date(),
    };

    const result = await carCollection.insertOne(carData);

    res.status(201).json({
      success: true,
      message: "Car added successfully.",
      insertedId: result.insertedId,
    });
  }),
);

// UPDATE CAR

app.put(
  "/product/:id",
  asyncHandler(async (req, res) => {
    const id = getObjectId(req.params.id);

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Invalid car ID.",
      });
    }

    const updatedCar = sanitizeDocument(req.body);

    if (!updatedCar) {
      return res.status(400).json({
        success: false,
        message: "Invalid update data.",
      });
    }

    const allowedFields = [
      "name",
      "price",
      "type",
      "rating",
      "brandName",
      "brand_name",
      "addButton",
      "detailsButton",
      "shortDescription",
      "image",
    ];

    const updateData = {};

    for (const field of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(updatedCar, field)) {
        updateData[field] = updatedCar[field];
      }
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid fields provided for update.",
      });
    }

    updateData.updatedAt = new Date();

    const result = await carCollection.updateOne(
      { _id: id },
      { $set: updateData },
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Car not found.",
      });
    }

    res.status(200).json({
      success: true,
      message: "Car updated successfully.",
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
    });
  }),
);

// DELETE CAR

app.delete(
  "/car/:id",
  asyncHandler(async (req, res) => {
    const id = getObjectId(req.params.id);

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Invalid car ID.",
      });
    }

    const result = await carCollection.deleteOne({ _id: id });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Car not found or already deleted.",
      });
    }

    res.status(200).json({
      success: true,
      message: "Car deleted successfully.",
      deletedCount: result.deletedCount,
    });
  }),
);

// ========================================
// MY CART ROUTES
// ========================================

// ADD TO CART

app.post(
  "/myCart",
  asyncHandler(async (req, res) => {
    const cartItem = sanitizeDocument(req.body);

    if (!cartItem) {
      return res.status(400).json({
        success: false,
        message: "Invalid cart data.",
      });
    }

    const newCartItem = {
      ...cartItem,
      createdAt: new Date(),
    };

    const result = await myCartCollection.insertOne(newCartItem);

    res.status(201).json({
      success: true,
      message: "Added to cart successfully.",
      insertedId: result.insertedId,
    });
  }),
);

// GET CART ITEMS

app.get(
  "/myCart",
  asyncHandler(async (req, res) => {
    const email =
      typeof req.query.email === "string" ? req.query.email.trim() : "";

    const query = email ? { email } : {};

    const cartItems = await myCartCollection.find(query).toArray();

    res.status(200).json(cartItems);
  }),
);

// DELETE CART ITEM

app.delete(
  "/myCart/:id",
  asyncHandler(async (req, res) => {
    const id = getObjectId(req.params.id);

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Invalid cart item ID.",
      });
    }

    const result = await myCartCollection.deleteOne({
      _id: id,
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Cart item not found.",
      });
    }

    res.status(200).json({
      success: true,
      message: "Cart item deleted successfully.",
      deletedCount: result.deletedCount,
    });
  }),
);

// ========================================
// BRAND CART ROUTES
// ========================================

// ADD BRAND

app.post(
  "/brandCarts",
  asyncHandler(async (req, res) => {
    const brand = sanitizeDocument(req.body);

    if (!brand) {
      return res.status(400).json({
        success: false,
        message: "Invalid brand data.",
      });
    }

    const newBrand = {
      ...brand,
      createdAt: new Date(),
    };

    const result = await brandCollection.insertOne(newBrand);

    res.status(201).json({
      success: true,
      message: "Brand added successfully.",
      insertedId: result.insertedId,
    });
  }),
);

// GET ALL BRANDS

app.get(
  "/brandCarts",
  asyncHandler(async (req, res) => {
    const brands = await brandCollection.find({}).toArray();

    res.status(200).json(brands);
  }),
);

// DELETE BRAND

app.delete(
  "/brandCarts/:id",
  asyncHandler(async (req, res) => {
    const id = getObjectId(req.params.id);

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Invalid brand ID.",
      });
    }

    const result = await brandCollection.deleteOne({
      _id: id,
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Brand not found.",
      });
    }

    res.status(200).json({
      success: true,
      message: "Brand deleted successfully.",
      deletedCount: result.deletedCount,
    });
  }),
);

// ========================================
// 404 HANDLER
// ========================================

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

// ========================================
// GLOBAL ERROR HANDLER
// ========================================

app.use((error, req, res, next) => {
  console.error("Server Error:", error);

  if (error.message === "Not allowed by CORS") {
    return res.status(403).json({
      success: false,
      message: "Origin not allowed.",
    });
  }

  if (error.type === "entity.parse.failed") {
    return res.status(400).json({
      success: false,
      message: "Invalid JSON request body.",
    });
  }

  if (error.type === "entity.too.large") {
    return res.status(413).json({
      success: false,
      message: "Request body is too large.",
    });
  }

  res.status(500).json({
    success: false,
    message: "Internal server error.",
  });
});

// ========================================
// VERCEL & LOCAL SERVER
// ========================================

// Vercel imports this app.
module.exports = app;

// Local development only.
if (require.main === module) {
  connectDB()
    .then(() => {
      const server = app.listen(PORT, () => {
        console.log(
          `Abrars Automobile API running at http://localhost:${PORT}`,
        );
      });

      const shutdown = async (signal) => {
        console.log(`${signal}: shutting down server...`);

        server.close(async () => {
          try {
            await client.close();
            console.log("MongoDB connection closed.");
            process.exit(0);
          } catch (error) {
            console.error("Shutdown error:", error.message);
            process.exit(1);
          }
        });
      };

      process.once("SIGINT", () => shutdown("SIGINT"));
      process.once("SIGTERM", () => shutdown("SIGTERM"));
    })
    .catch((error) => {
      console.error("Server startup failed:", error);
      process.exit(1);
    });
}
