const { test } = require("@playwright/test");
const fs = require("fs");
import { pushInfluxMetrics } from "../utils/utils";

const videosData = fs.readFileSync("./videos.json");
const videos = JSON.parse(videosData);

const { GRAFANA_CLOUD_ID, GRAFANA_API_KEY, INFLUX_METRICS_URL } = process.env;

for (const username of Object.keys(videos)) {
  for (const videoId of Object.keys(videos[username])) {
    test(`Update video stats for user ${username} video ${videoId}`, async ({
      page,
    }) => {
      const video = videos[username][videoId];
      await page.goto(`https://www.tiktok.com/@${username}/video/${videoId}`);
      await page.locator("[data-e2e=browser-nickname] span").last().waitFor();
      let APPSTATE = await page.evaluate(() => window.SIGI_STATE);

      if (APPSTATE) {
        video.createTime = parseInt(APPSTATE.ItemModule[videoId].createTime);
        video.views = APPSTATE.ItemModule[videoId].stats.playCount;
        video.likes = APPSTATE.ItemModule[videoId].stats.diggCount;
        video.comments = APPSTATE.ItemModule[videoId].stats.commentCount;
        video.shares = APPSTATE.ItemModule[videoId].stats.shareCount;
        await pushInfluxMetrics(
          [
            {
              name: "video",
              tags: [
                { name: "user", value: username },
                { name: "platform", value: "tiktok" },
                { name: "source", value: "influencer-monitor" },
              ],
              fields: [
                { name: "views", value: video.views },
                { name: "likes", value: video.likes },
                { name: "comments", value: video.comments },
                { name: "shares", value: video.shares },
              ],
            },
          ],
          INFLUX_METRICS_URL,
          GRAFANA_CLOUD_ID,
          GRAFANA_API_KEY
        );
      } else {
        console.log("No APPSTATE found for video " + videoId);
      }
    });
  }
}

test.afterAll(async () => {
  fs.writeFileSync("./videos.json", JSON.stringify(videos));
});
