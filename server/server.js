import express from "express";
import cors from "cors";
import OpenAI from "openai";


const openai = new OpenAI({
  apiKey: process.env['OPENAI_API_KEY'], // This is the default and can be omitted
});

// Setting up express
const app = express();
app.use(cors());
app.use(express.json());

// Root endpoint
app.get("/", async (req, res) => {
  res.status(200).send({
    message: "Hello from MetaBase",
  });
});

// New endpoint to fetch available models
app.get("/models", async (req, res) => {
  try {
    const response = await openai.listModels();
    res.status(200).send({
      models: response.data.data,
    });
  } catch (error) {
    console.error("Error fetching models:", error.message);
    res.status(500).send({
      error: "Failed to fetch models. Please try again later.",
    });
  }
});

// Endpoint for generating responses
app.post("/", async (req, res) => {
  try {
    const prompt = req.body.prompt;

    if (!prompt) {
      return res.status(400).send({ error: "Prompt is required." });
    }
    const response = await openai.chat.completions.create({
      messages: [{ role: "user", content: `${prompt}` }],
      model: "gpt-4o-mini", // Updated model
    });

    res.status(200).send({
      bot: response.choices[0].message.content,
    });
  } catch (error) {
    console.error("Error generating response:", error.message);
    res.status(500).send({
      error: "Something went wrong. Please try again later.",
    });
  }
});

// Start the server
const PORT = process.env.PORT || 5172; // Configurable port
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

