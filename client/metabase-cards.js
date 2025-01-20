import axios from "axios";

async function fetchDashboardMetadata(dashboardId) {
  const url = `https://metabase.integration.opengov.zone/api/dashboard/${dashboardId}`;
  const headers = { "X-Metabase-Session": process.env.METABASE_API_KEY };

  try {
    const response = await axios.get(url, { headers });
    return response.data.cards.map((card) => card.card.id); // Extract card IDs
  } catch (error) {
    console.error("Error fetching dashboard metadata:", error.message);
    throw error;
  }
}

async function fetchCardData(cardId) {
  const url = `https://metabase.integration.opengov.zone/api/card/${cardId}/query/json`;
  const headers = { "X-Metabase-Session": process.env.METABASE_API_KEY };

  try {
    const response = await axios.get(url, { headers });
    return { cardId, data: response.data }; // Return card data
  } catch (error) {
    console.error(`Error fetching data for card ${cardId}:`, error.message);
    throw error;
  }
}

(async () => {
  const dashboardId = 30; // Replace with your dashboard ID

  try {
    // Step 1: Fetch dashboard metadata
    const cardIds = await fetchDashboardMetadata(dashboardId);

    // Step 2: Fetch data for each card
    const cardDataPromises = cardIds.map((cardId) => fetchCardData(cardId));
    const allCardData = await Promise.all(cardDataPromises);

    console.log("All Card Data:", JSON.stringify(allCardData, null, 2));
  } catch (error) {
    console.error("Error fetching dashboard data:", error.message);
  }
})();

