import OpenAI from "openai";
import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const openai = new OpenAI({
  apiKey: process.env['OPENAI_API_KEY'], // OpenAI API Key
});

const METABASE_CARD_ID = 6193;
const METABASE_SSO_URL = "https://metabase-server.integration.opengov.zone/sso/metabase";
const METABASE_QUERY_URL = `https://metabase.integration.opengov.zone/api/card/${METABASE_CARD_ID}/query_metadata`;
const METABASE_CARD_DATA = `https://metabase.integration.opengov.zone/api/card/${METABASE_CARD_ID}/query/json`;

// Cache for storing metadata
let cachedMetadata = null;
let metadataLastFetched = null;
const CACHE_EXPIRY = 60 * 60 * 1000; // 60 minutes

// Setting up express
const app = express();
app.use(cors());
app.use(express.json());

// Function to fetch X-Metabase-Session
async function fetchMetabaseSession() {
  try {
    const response = await fetch(METABASE_SSO_URL);
    if (!response.ok) {
      throw new Error(`Failed to fetch Metabase session: ${response.statusText}`);
    }
    const data = await response.json();
    return data.id; // Extract the session ID from the JSON response
  } catch (error) {
    console.error("Error fetching Metabase session:", error.message);
    throw error;
  }
}

// Function to fetch metadata from Metabase API
async function fetchMetadata(session) {
  if (cachedMetadata && metadataLastFetched && Date.now() - metadataLastFetched < CACHE_EXPIRY) {
    console.log("Using cached metadata.");
    return cachedMetadata; // Return cached metadata if still valid
  }


  const metabaseResponse = await fetch(METABASE_QUERY_URL, {
    method: "GET",
    headers: {
      "X-Metabase-Session": session,
      "Content-Type": "application/json",
    },
  });
  
  const metabaseResponseData = await fetch(METABASE_CARD_DATA, {
    method: "POST",
    headers: {
      "X-Metabase-Session": session,
      "Content-Type": "application/json",
    },
  });


  if (!metabaseResponse.ok) {
    throw new Error(`Metabase API error: ${metabaseResponse.statusText}`);
  }

  const jsonData = await metabaseResponse.json();
  const jsonCardData = await metabaseResponseData.json();
 
  // Transform data to include only required fields
  const combinedData = {
    databases: jsonData.databases.map(database => ({
        id: database.id,
        name: database.name,
        details: database.details,
    })),
    tables: jsonData.tables.map(table => ({
        id: table.id,
        name: table.name,
        display_name: table.display_name,
        db_id: table.db_id,
        fields: table.fields.map(field => ({
            database_type: field.database_type,
            table_id: field.table_id,
            display_name: field.display_name,
            name: field.name
        }))
    }))
};
  cachedMetadata = {
  metadata: combinedData,
  visualizationData: jsonCardData,
};
  console.log(cachedMetadata);
  metadataLastFetched = Date.now(); // Update the cache timestamp
  return cachedMetadata;
}

// Endpoint to ask a question using metadata
app.post("/ask", async (req, res) => {
  try {
    const userQuestion = req.body.prompt;
    if (!userQuestion) {
      return res.status(400).send({ error: "Prompt is required." });
    }

    // Fetch a single Metabase session for this request
    const metabaseSession = await fetchMetabaseSession();

    // Get metadata (cached or fresh)
    const metadata = await fetchMetadata(metabaseSession);

    // Send metadata and user's question to OpenAI
    const openAIResponse = await openai.chat.completions.create({
      messages: [
        { role: "system", content: `You are an AI assistant. Use the following to answer questions: ${JSON.stringify(metadata, null, 2)}.
- If the query is about details on tables, databases, or fields, use metadata to inform your response, ensuring that the answer is more accurate and contextually appropriate.
- If a user requests "make a SQL query for me" and you return a SQL query, it must contain only SQL code without additional text or formatting—simply sql content only.
- If user wants to visualize current card that uses visualizationData to answer a user query, start your response with "Output Result-" followed by a table showing the visualization data.
- If the user wants to visualize data that doesnt depend visualizationData, start your response with "Intermediate Query Result-" and it must contain only SQL code without additional text or formatting—simply sql content only.
` },
        { role: "user", content: userQuestion },
      ],
      model: "gpt-4", // Specify the model
      temperature: 0.7,
    });

    const botResponse = openAIResponse.choices[0].message.content;

    if (botResponse.startsWith("Intermediate Query Result-")) {
      // Extract the SQL query (this might require parsing depending on your prompt format)
      const queryMatch = botResponse.match(/```sql([\s\S]*?)```/);
      if (queryMatch && queryMatch[1]) {
        const extractedQuery = queryMatch[1].trim();
        console.log(extractedQuery);

        // Make the Metabase API call
        const metabaseDatasetResponse = await fetch('https://metabase.integration.opengov.zone/api/dataset', {
          method: 'POST',
          headers: {
            'X-Metabase-Session': metabaseSession,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            database: 3,
            type: "native",
            native: {
              query: extractedQuery,
              "template-tags": {}
            },
            parameters: []
          }),
        });

        if (!metabaseDatasetResponse.ok) {
          throw new Error(`Metabase API returned status ${metabaseResponse.status}`);
        }

        const metabaseDatasetData = await metabaseDatasetResponse.json();

	// Assuming metabaseDatasetData is already available
	const { rows, cols } = metabaseDatasetData.data;

	// Build the output dynamically
	let output = 'Output Result-\n';

	// Add column headers from data.cols
	const headers = cols.map(col => col.display_name || col.name);
	output += headers.join('\t') + '\n'; // Join headers with tab characters

	// Add each data row
	for (const row of rows) {
	  output += row.join('\t') + '\n'; // Join row values with tab characters
	}

        // Respond with the Metabase query result
        return res.status(200).send({ bot: output });
      } else {
        // If the query is not in the expected format, handle it as an error or return a default response
        return res.status(400).send({ error: "There is some issue while processing" });
      }
    } else {
      // If no Intermediate Query Result-, return the original OpenAI response
      return res.status(200).send({ bot: botResponse });
    }
  } catch (error) {
    console.error("Error processing request:", error.message);
    return res.status(500).send({ error: "Something went wrong. Please try again later." });
  }
});


// Endpoint to force refresh metadata
app.post("/refresh-metadata", async (req, res) => {
  try {
    cachedMetadata = null;
    metadataLastFetched = null;
    await fetchMetadata(); // Force fetch fresh metadata
    res.status(200).send({ message: "Metadata refreshed successfully." });
  } catch (error) {
    console.error("Error refreshing metadata:", error.message);
    res.status(500).send({
      error: "Failed to refresh metadata.",
    });
  }
});

// Start the server
const PORT = process.env.PORT || 5172; // Configurable port
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

