// Single source of truth for FAQ content. Consumed by:
//   • src/pages/index.astro  — the visible "Questions, answered." accordion
//   • the FAQPage JSON-LD emitted on the homepage
//   • src/pages/llms-full.txt.ts — the AI / LLM full-content export
// Keeping the copy here means on-page content, structured data and the
// AI-facing exports can never drift apart.

export interface Faq {
  q: string;
  a: string;
}

// SEO FAQ — questions rendered as real H3 headings and mirrored into FAQPage
// JSON-LD so the schema always matches visible content.
export const seoFaqs: Faq[] = [
  {
    q: 'What is a Speed Test?',
    a: `A speed test is a quick diagnostic that measures how fast data travels between your device and the internet. In a few seconds, a network speed test records your download speed, upload speed, ping and latency, giving you real numbers instead of guesswork about your connection. Meter runs the test right in your browser, streaming data to nearby edge servers to push your line to its limit and capture an accurate reading. The result tells you whether your connection can comfortably handle streaming, gaming, video calls and large downloads. Running an online speed test regularly is the easiest way to confirm you’re getting the performance you pay for and to spot slowdowns before they disrupt your day.`,
  },
  {
    q: 'What is an Internet Speed Test?',
    a: `An internet speed test measures the actual performance of your broadband or mobile connection at the moment you run it. Rather than trusting the number on your bill, the test sends and receives data to calculate your real download speed, upload speed and ping in megabits per second and milliseconds. Meter’s internet speed test works entirely online, using multiple parallel connections to fully saturate your line so the reading reflects true capacity. It also measures jitter, packet loss and latency under load, which reveal how stable your connection feels during calls and games. Because conditions change with congestion, Wi-Fi and time of day, running an internet speed test at different times gives you the clearest picture of what your provider delivers.`,
  },
  {
    q: 'What’s My Speed Test?',
    a: `“What’s my speed test” usually means you want to see your current internet speed right now. To find out, open Meter and tap GO — the online speed test measures your download speed, upload speed and ping within about ten seconds and displays them clearly. Your download number shows how quickly data reaches you, upload shows how fast you can send files, and ping reveals responsiveness. Meter also scores your connection and explains what it can realistically handle, from 4K streaming to video conferencing. Results are saved locally so you can compare each network speed test over time. If a reading looks low, run it again on a wired connection with other devices idle to confirm whether the slowdown is your line or local Wi-Fi.`,
  },
  {
    q: 'How to Test Internet Speed?',
    a: `To test internet speed, use a browser-based speed test like Meter and start a measurement with a single tap. The tool first checks your ping and latency, then measures download speed, and finally upload speed, reporting each result in real time. For the most accurate internet speed test, close bandwidth-heavy apps, pause other downloads and keep additional devices off the network while the test runs. A wired Ethernet connection removes Wi-Fi interference and shows your line’s true capacity, while a wifi speed test reflects everyday wireless performance. Run the test two or three times and compare the numbers, since a single reading can be affected by momentary congestion. This simple routine gives you a dependable snapshot of exactly how fast your connection performs.`,
  },
  {
    q: 'How to Test My Internet Speed?',
    a: `You can test your internet speed in seconds without installing anything. Open Meter in any browser, choose a test mode, and press GO to begin the network speed test. It measures your download speed, upload speed, ping, jitter and latency under load, then translates those numbers into plain-language ratings for browsing, streaming, gaming and calls. To keep your reading honest, connect over Ethernet when possible, or stand near your router for a wifi speed test, and make sure no big downloads are running in the background. Testing your internet speed at different times of day highlights congestion patterns from your provider. Because Meter stores each result locally, you build a personal history that makes it easy to prove a problem to your ISP.`,
  },
  {
    q: 'How Do I Test My Internet Speed?',
    a: `To test your internet speed, simply load an online speed test and let it measure the connection between your device and the nearest server. With Meter, you press GO and the ping test runs first, followed by the download speed test and upload speed test, with live results updating as data flows. You don’t need an account or app — everything happens in the browser. For reliable numbers, test one device at a time, pause streaming and cloud backups, and prefer a wired link to isolate your line from Wi-Fi limits. If you’re troubleshooting slow speeds, run the internet speed test both close to and far from your router; a big gap points to a wireless problem rather than your broadband plan itself.`,
  },
  {
    q: 'How Can I Test My Internet Speed?',
    a: `You can test your internet speed using any modern browser on a phone, tablet, laptop or desktop — no download required. Visit Meter, pick Quick, Balanced or Thorough, and start the test to measure download speed, upload speed, ping and latency. Because Meter is a fully online speed test, it streams data to global edge servers to gauge your connection’s real throughput. For the truest result, run a network speed test over Ethernet; for a realistic everyday reading, run a wifi speed test from where you normally sit. Try the test on more than one device to see whether a slowdown follows your line or a single gadget. Each measurement is saved on your device, so tracking performance over days or weeks takes no extra effort.`,
  },
  {
    q: 'How to Test Your Internet Speed?',
    a: `Testing your internet speed takes only a moment with a web-based tool. Open Meter, tap GO, and the speed test measures how fast data downloads to your device, how fast it uploads, and how quickly your connection responds during a ping test. Watch the live gauge as it captures the stable portion of each phase for an accurate reading. To get dependable numbers, shut down large downloads, disconnect idle devices, and use a wired connection when you want to measure the line itself rather than your Wi-Fi. Repeating the internet speed test a few times, and at different hours, reveals whether slowdowns come from network congestion. Meter finishes by scoring your connection and showing exactly what it can handle, so the result is genuinely useful.`,
  },
  {
    q: 'How to Test the Internet Speed?',
    a: `To test the internet speed on any connection, open a browser-based tool such as Meter and begin a measurement. The speed test first runs a latency test to record ping and jitter, then measures download and upload throughput in megabits per second. Results appear live, and the whole network speed test typically finishes in about ten seconds. For accuracy, test a single device at a time, pause background apps, and choose Ethernet over Wi-Fi to see your line’s full capacity. If you’re checking a shared or office connection, run the online speed test from several locations to map coverage and find weak spots. Comparing repeated readings helps separate a genuine broadband issue from a temporary dip caused by peak-hour congestion or a busy home network.`,
  },
  {
    q: 'How to Run an Internet Speed Test?',
    a: `Running an internet speed test is straightforward: open Meter in your browser and press GO to start. The tool automatically selects a nearby server, runs a quick ping test, and then measures your download speed and upload speed while showing throughput on a live graph. You can pick Quick for a fast check, Balanced for everyday accuracy, or Thorough for the most detailed reading. Before you run the test, close streaming tabs and pause downloads so nothing competes for bandwidth. Use Ethernet to benchmark your plan or Wi-Fi to gauge real-world performance. When the network speed test finishes, Meter grades your connection and lists what it can support, then saves the result locally so you can run it again later and compare.`,
  },
  {
    q: 'How to Test Internet Speed Online?',
    a: `Testing your internet speed online means running the whole measurement in a browser with nothing to install. Open Meter, and the online speed test connects to nearby edge servers to measure download speed, upload speed, ping and latency under load in real time. Because it’s browser-based, the same speed test works on Windows, macOS, Android, iOS and Chromebooks alike. For an accurate reading, pause other devices and background transfers, and switch to Ethernet if you want to measure your line rather than your Wi-Fi. An online speed test is ideal for quick, repeatable checks — bookmark Meter and run it whenever streaming buffers, calls drop, or downloads crawl. Each result is stored on your device, so you can build a history and spot patterns without signing up.`,
  },
  {
    q: 'How to Test Internet Speed on PC?',
    a: `To test internet speed on a PC, open any browser — Chrome, Edge or Firefox — go to Meter, and press GO. The speed test measures your download speed, upload speed, ping and jitter directly on your desktop or laptop without extra software. For the most accurate result on a PC, connect with an Ethernet cable to bypass Wi-Fi limits, close background apps like cloud sync and updates, and make sure no downloads are running. If you must use Wi-Fi, run the wifi speed test near the router first, then from your usual spot to compare. Windows PCs often run silent background transfers, so a repeat test confirms whether a low number is real. Meter then rates your connection for work, streaming and gaming so the numbers actually mean something.`,
  },
  {
    q: 'How to Test WiFi Speed?',
    a: `To test WiFi speed, connect your phone or laptop to the wireless network and run Meter’s speed test from where you normally use the device. The wifi speed test measures download speed, upload speed and ping over the air, capturing the performance you actually experience rather than the maximum your plan allows. Because walls, distance and interference weaken Wi-Fi, test in several rooms to map coverage and find dead zones. Compare a reading beside the router with one across the house; a large drop signals a Wi-Fi problem, not a slow internet plan. For a reference point, run a wired internet speed test too, then subtract the difference to see what wireless is costing you. Repeat the test on the 5 GHz band for faster nearby speeds.`,
  },
  {
    q: 'How to Test My WiFi Speed?',
    a: `You can test your WiFi speed in seconds by opening Meter on a device connected to your wireless network and pressing GO. The wifi speed test reports download speed, upload speed and ping exactly where you’re sitting, which reflects real everyday performance better than the number on your bill. Move around while you test — near the router, one room away, and at the far edge of the house — to see how much signal strength changes your speed. If the reading is far below your plan, the bottleneck is usually Wi-Fi rather than your broadband line, so try the 5 GHz band, reposition the router, or reduce interference. Running the network speed test on both Wi-Fi and Ethernet makes it easy to tell exactly where a slowdown begins.`,
  },
  {
    q: 'What Is a Good Speed Test Result?',
    a: `A good speed test result depends on what you do online, but useful benchmarks help. For most households, 100 Mbps download is comfortable for HD streaming and browsing, 300–500 Mbps suits busy homes with several 4K streams and downloads, and gigabit plans give plenty of headroom. On the upload side, 10–20 Mbps handles video calls and cloud backups, though fiber often delivers much more. Just as important are latency and stability: a good ping test shows under about 30 ms, with low jitter and little rise in latency under load. A connection with high download speed but poor latency can still feel sluggish on calls and games. Meter combines all of these into a single score, so you can judge your result at a glance.`,
  },
  {
    q: 'What Is Ping on a Speed Test?',
    a: `Ping on a speed test measures how long a small piece of data takes to travel from your device to a server and back, reported in milliseconds. It’s a latency test, so lower is better: a low ping means your connection responds instantly, which matters most for online gaming, video calls and live streaming. During the ping test, Meter also measures jitter — the variation between pings — and latency under load, which shows how much delay rises while your line is busy downloading or uploading. A connection can post fast download speeds yet still feel laggy if ping is high or unstable. As a rough guide, under 30 ms is excellent, 30–70 ms is fine for most uses, and above 100 ms starts to feel sluggish.`,
  },
  {
    q: 'Download Speed Test',
    a: `A download speed test measures how quickly data travels from the internet to your device, the number that matters most for streaming, browsing and downloading files. Meter runs the download speed test by pulling data through several parallel connections to fully load your line, then reports the result in megabits per second. Higher download speed means smoother 4K video, faster page loads and quicker downloads. To measure accurately, pause other devices and background apps, and use Ethernet to capture your line’s full capacity or Wi-Fi to gauge real-world performance. Remember that a complete internet speed test also checks upload speed and ping, since responsiveness and the ability to send data matter too. Run Meter’s download speed test a few times and compare the readings.`,
  },
];

// Meter-specific questions that lead the "Questions, answered." accordion,
// kept as data so the visible list and the FAQPage schema share one source.
export const curatedFaqs: Faq[] = [
  {
    q: 'How does Meter measure my speed?',
    a: 'Meter runs entirely in your browser. It streams data to and from Cloudflare’s global edge network — the same infrastructure that serves a large share of the web — using several parallel connections to fully saturate your line, then aggregates the stable portion of each run.',
  },
  {
    q: 'What is latency under load (bufferbloat)?',
    a: 'It’s how much your ping rises when the connection is busy. A line can look fast yet feel terrible on calls because latency balloons during uploads or downloads. Meter grades this A+ to F so you can spot it.',
  },
  {
    q: 'Why is my result different from my plan’s speed?',
    a: 'Wi-Fi, the device you’re on, time of day, VPNs and background apps all cost speed. For the truest number, test over a wired connection with other devices idle, and run it a few times.',
  },
  {
    q: 'Is packet loss really measured in a browser?',
    a: 'Browsers can’t see raw packets, so Meter estimates loss from probes that fail or time out during the test. Treat it as a stability signal rather than a lab-grade figure — that’s why it’s labelled an estimate.',
  },
  {
    q: 'How much data does a test use?',
    a: 'Meter stops each phase the moment your speed stabilises, so a Balanced run usually finishes in about ten seconds and moves 100–400 MB depending on how fast your line is. On a metered or mobile plan, choose Quick.',
  },
];

// One unified list drives both the visible accordion and the FAQPage structured
// data. The curated Meter questions lead; the Speed Test guide questions follow.
export const faqs: Faq[] = [...curatedFaqs, ...seoFaqs];
