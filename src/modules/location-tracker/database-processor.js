import { kafkaClient } from "./kafka-client.js";

export async function startDatabaseProcessor() {
  const consumer = kafkaClient.consumer({ groupId: "database-processor" });
  await consumer.connect();

  await consumer.subscribe({ topics: ["location-updates"], fromBeginning: true });

  await consumer.run({
    eachMessage: async ({ message, heartbeat }) => {
      const data = JSON.parse(message.value.toString());
      console.log("INSERT INTO location_history:", {
        userId: data.userId,
        latitude: data.latitude,
        longitude: data.longitude,
        recordedAt: new Date().toISOString(),
      });
      await heartbeat();
    },
  });
}

if (import.meta.url === new URL(process.argv[1], "file://").href) {
  startDatabaseProcessor();
}
