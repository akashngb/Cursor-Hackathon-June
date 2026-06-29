import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  Modal,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { captureRef } from 'react-native-view-shot';
import * as WebBrowser from 'expo-web-browser';

// === EDIT ME ===
const SERVER_URL = 'http://100.71.89.140:8000/webhook/capture';
const FINALIZE_URL = 'http://100.71.89.140:8000/webhook/finalize';

// Tavus — bartering agent (hackathon creds, do not ship)
const TAVUS_API_KEY = '05b3534b44124e74909970b247d0115a';
const TAVUS_REPLICA_ID = 'rf8f3aa4b33e';
const TAVUS_PERSONA_ID = 'p005964a827f';
const TAVUS_CREATE_URL = 'https://tavusapi.com/v2/conversations';

const THEMES = [
  { name: 'cat', ears: '🐱', nose: '👃' },
  { name: 'dog', ears: '🐶', nose: '👃' },
  { name: 'fox', ears: '🦊', nose: '🥸' },
  { name: 'bear', ears: '🐻', nose: '👃' },
  { name: 'panda', ears: '🐼', nose: '🥸' },
  { name: 'tiger', ears: '🐯', nose: '👃' },
];
const EXTRAS = ['🕶️', '🥳', '👑', '🤡', '😎', '🥸', '✨'];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const jitter = (amount) => (Math.random() - 0.5) * 2 * amount;

function fakeFaceBox(viewW, viewH) {
  const w = viewW * 0.55;
  const h = w * 1.15;
  const x = (viewW - w) / 2 + jitter(viewW * 0.06);
  const y = viewH * 0.16 + jitter(viewH * 0.04);
  return { x, y, w, h };
}

async function createTavusConversation(jobId, totalValue, breakdown) {
  const summary = breakdown
    .slice(0, 3)
    .map((b) => `${b.id} ($${b.value})`)
    .join(', ');
  const body = {
    replica_id: TAVUS_REPLICA_ID,
    persona_id: TAVUS_PERSONA_ID,
    conversation_name: `Barter ${jobId}`,
    conversational_context:
      `Wedding photo job ${jobId}. Base quote: $${totalValue}. ` +
      `Top items: ${summary}. The customer wants to barter — negotiate but stay profitable.`,
  };
  const res = await fetch(TAVUS_CREATE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': TAVUS_API_KEY,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Tavus ${res.status}: ${t.slice(0, 160)}`);
  }
  return res.json();
}

// Simulates a negotiated price (75–95% of quoted) since Tavus doesn't surface
// the agreed amount programmatically. Seeded by jobId for repeatability.
async function finalizeJob(jobId, quotedTotal) {
  const seed = jobId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const discount = 0.75 + ((seed % 20) / 100); // 75–95%
  const finalPrice = Math.round(quotedTotal * discount * 100) / 100;
  const res = await fetch(FINALIZE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      job_id: jobId,
      customer: { name: 'Demo User', email: 'demo@example.com' },
      final_price: finalPrice,
      image_count: 1,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Finalize ${res.status}: ${t.slice(0, 120)}`);
  }
  return res.json();
}

export default function App() {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef(null);
  const previewRef = useRef(null);

  const [photoUri, setPhotoUri] = useState(null);
  const [theme, setTheme] = useState(THEMES[0]);
  const [bonus, setBonus] = useState(null);
  const [box, setBox] = useState(null);
  const [status, setStatus] = useState('idle');
  const [timings, setTimings] = useState(null);
  const [quote, setQuote] = useState(null);
  const [tavusUrl, setTavusUrl] = useState(null);
  const [tavusError, setTavusError] = useState(null);
  const [invoice, setInvoice] = useState(null);
  const [finalizing, setFinalizing] = useState(false);

  if (!permission) {
    return (
      <View style={styles.center}>
        <Text style={styles.dim}>Loading…</Text>
      </View>
    );
  }
  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.heading}>Camera permission required</Text>
        <TouchableOpacity style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>Grant permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const resetToCamera = () => {
    setStatus('idle');
    setPhotoUri(null);
    setBox(null);
    setQuote(null);
    setTavusUrl(null);
    setTavusError(null);
    setInvoice(null);
    setFinalizing(false);
  };

  const captureAndSend = async () => {
    if (!cameraRef.current || (status !== 'idle' && status !== 'ready')) return;
    resetToCamera();
    const t0 = Date.now();
    setStatus('capturing');
    setTimings(null);

    try {
      const pic = await cameraRef.current.takePictureAsync({
        quality: 0.7,
        skipProcessing: true,
      });
      const t1 = Date.now();

      const chosenTheme = pick(THEMES);
      const chosenBonus = Math.random() > 0.3 ? pick(EXTRAS) : null;
      const win = Dimensions.get('window');
      const previewW = win.width;
      const previewH = win.height * 0.7;
      const faceBox = fakeFaceBox(previewW, previewH);

      setTheme(chosenTheme);
      setBonus(chosenBonus);
      setBox(faceBox);
      setPhotoUri(pic.uri);

      await new Promise((r) => setTimeout(r, 120));
      const t2 = Date.now();

      const base64 = await captureRef(previewRef, {
        format: 'jpg',
        quality: 0.8,
        result: 'base64',
      });
      const t3 = Date.now();

      setStatus('sending');
      const jobId = `job-${Date.now()}`;
      const imgId = `img-${Date.now()}`;
      const res = await fetch(SERVER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: jobId,
          customer: { name: 'Demo User', email: 'demo@example.com' },
          images: [{ id: imgId, data: base64 }],
        }),
      });
      const t4 = Date.now();

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Server ${res.status}: ${text.slice(0, 120)}`);
      }
      const json = await res.json();
      console.log('Server response:', json);
      setQuote({ jobId, total: json.total_value, breakdown: json.breakdown });

      setTimings({
        capture: t1 - t0,
        prepare: t2 - t1,
        composite: t3 - t2,
        send: t4 - t3,
        total: t4 - t0,
      });

      setStatus('ready');
    } catch (err) {
      console.error('Capture pipeline failed:', err);
      Alert.alert('Capture failed', String(err?.message || err));
      setStatus('error');
      setTimeout(resetToCamera, 2200);
    }
  };

  const openBarter = async () => {
    if (!tavusUrl) return;
    try {
      await WebBrowser.openBrowserAsync(tavusUrl);
    } catch (e) {
      Alert.alert('Could not open conversation', String(e?.message || e));
    }
    // Reopen only — finalize was already triggered by startBartering
  };

  const startBartering = async () => {
    if (!quote || status === 'bartering') return;
    setTavusError(null);
    setStatus('bartering');

    let conversationUrl = null;
    try {
      const tavus = await createTavusConversation(quote.jobId, quote.total, quote.breakdown);
      console.log('Tavus conversation:', tavus);
      conversationUrl = tavus.conversation_url;
      setTavusUrl(conversationUrl);
      setStatus('ready');
    } catch (tavusErr) {
      console.error('Tavus failed:', tavusErr);
      setTavusError(String(tavusErr?.message || tavusErr));
      setStatus('ready');
      return;
    }

    // Open the bartering session — this blocks until the user closes the browser.
    try {
      await WebBrowser.openBrowserAsync(conversationUrl);
    } catch (e) {
      Alert.alert('Could not open conversation', String(e?.message || e));
      return;
    }

    // Browser dismissed — barter is done. Finalize and show invoice.
    setFinalizing(true);
    try {
      const inv = await finalizeJob(quote.jobId, quote.total);
      console.log('Finalize response:', inv);
      setInvoice(inv);
    } catch (err) {
      console.error('Finalize failed:', err);
      Alert.alert('Could not finalize invoice', String(err?.message || err));
    } finally {
      setFinalizing(false);
    }
  };

  const payNow = async () => {
    if (!invoice?.stripe_payment_url) {
      Alert.alert('No payment link', 'Stripe payment link was not generated (check server logs).');
      return;
    }
    try {
      await WebBrowser.openBrowserAsync(invoice.stripe_payment_url);
    } catch (e) {
      Alert.alert('Could not open payment link', String(e?.message || e));
    }
  };

  const showPreview = !!photoUri && status !== 'idle';
  const busy = status === 'capturing' || status === 'sending';

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      <View style={styles.stage}>
        <CameraView ref={cameraRef} style={styles.camera} facing="back" />

        {showPreview && (
          <View ref={previewRef} collapsable={false} style={styles.preview}>
            <Image
              source={{ uri: photoUri }}
              style={styles.previewImg}
              resizeMode="cover"
            />
            {box && (
              <>
                <Text
                  style={[
                    styles.sticker,
                    {
                      left: box.x,
                      top: box.y - box.h * 0.35,
                      fontSize: box.w * 0.55,
                      width: box.w,
                      textAlign: 'center',
                    },
                  ]}
                >
                  {theme.ears}
                </Text>
                <Text
                  style={[
                    styles.sticker,
                    {
                      left: box.x + box.w * 0.3,
                      top: box.y + box.h * 0.42,
                      fontSize: box.w * 0.4,
                    },
                  ]}
                >
                  {theme.nose}
                </Text>
                {bonus && (
                  <Text
                    style={[
                      styles.sticker,
                      {
                        left: box.x - box.w * 0.1,
                        top: box.y + box.h * 0.08,
                        fontSize: box.w * 0.45,
                      },
                    ]}
                  >
                    {bonus}
                  </Text>
                )}
              </>
            )}
          </View>
        )}

        {busy && (
          <View style={styles.overlay} pointerEvents="none">
            <ActivityIndicator color="#fff" size="large" />
            <Text style={styles.overlayText}>
              {status === 'capturing' ? 'Watermarking…' : 'Sending…'}
            </Text>
          </View>
        )}

        {(status === 'ready' || status === 'bartering') && (
          <View style={styles.readyOverlay}>
            <Text style={styles.checkmark}>✅</Text>
            {quote && (
              <Text style={styles.quoteText}>Quoted ${quote.total}</Text>
            )}
            {finalizing ? (
              <>
                <ActivityIndicator color="#fff" size="large" style={{ marginTop: 24 }} />
                <Text style={styles.finalizingText}>Preparing invoice…</Text>
              </>
            ) : tavusUrl ? (
              <TouchableOpacity style={styles.barterBtn} onPress={openBarter}>
                <Text style={styles.barterBtnText}>🤝 Reopen bartender</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.barterBtn, status === 'bartering' && styles.barterBtnBusy]}
                disabled={status === 'bartering'}
                onPress={startBartering}
              >
                {status === 'bartering' ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.barterBtnText}>🤝 Start bartering</Text>
                )}
              </TouchableOpacity>
            )}
            {tavusError && (
              <Text style={styles.errText}>Tavus: {tavusError}</Text>
            )}
            {!finalizing && (
              <TouchableOpacity style={styles.dismissBtn} onPress={resetToCamera}>
                <Text style={styles.dismissBtnText}>Take another</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {status === 'error' && (
          <View style={styles.overlay} pointerEvents="none">
            <Text style={styles.checkmark}>⚠️</Text>
            <Text style={styles.overlayText}>Failed</Text>
          </View>
        )}
      </View>

      <View style={styles.controls}>
        <TouchableOpacity
          accessibilityLabel="Capture"
          style={[
            styles.shutter,
            status !== 'idle' && status !== 'ready' && styles.shutterDisabled,
          ]}
          disabled={status !== 'idle' && status !== 'ready'}
          onPress={captureAndSend}
        />
        {timings ? (
          <Text style={styles.timings}>
            cap {timings.capture}ms · comp {timings.composite}ms · send{' '}
            {timings.send}ms · total {timings.total}ms
          </Text>
        ) : (
          <Text style={styles.timings}>Tap to capture · watermark · send</Text>
        )}
      </View>

      {/* Invoice modal — slides up after bartering ends */}
      <Modal visible={!!invoice} animationType="slide" transparent={false}>
        <ScrollView
          style={styles.invoiceModal}
          contentContainerStyle={styles.invoiceContent}
        >
          <Text style={styles.invoiceHeader}>📄 INVOICE</Text>
          <Text style={styles.invoiceSubtitle}>Wedding Photography</Text>

          <View style={styles.invoiceDivider} />

          <View style={styles.invoiceRow}>
            <Text style={styles.invoiceLabel}>Job</Text>
            <Text style={styles.invoiceValue} numberOfLines={1} ellipsizeMode="middle">
              {invoice?.job_id}
            </Text>
          </View>
          <View style={styles.invoiceRow}>
            <Text style={styles.invoiceLabel}>Date</Text>
            <Text style={styles.invoiceValue}>
              {new Date().toLocaleDateString()}
            </Text>
          </View>
          <View style={styles.invoiceRow}>
            <Text style={styles.invoiceLabel}>Customer</Text>
            <Text style={styles.invoiceValue}>Demo User</Text>
          </View>
          <View style={styles.invoiceRow}>
            <Text style={styles.invoiceLabel}>Photos</Text>
            <Text style={styles.invoiceValue}>1</Text>
          </View>

          <View style={styles.invoiceDivider} />

          {quote && (
            <View style={styles.invoiceRow}>
              <Text style={styles.invoiceLabel}>Quoted</Text>
              <Text style={styles.invoiceValue}>${quote.total.toFixed(2)}</Text>
            </View>
          )}
          {quote && invoice && (
            <View style={styles.invoiceRow}>
              <Text style={[styles.invoiceLabel, { color: '#34c759' }]}>Barter savings</Text>
              <Text style={[styles.invoiceValue, { color: '#34c759' }]}>
                −${(quote.total - invoice.final_price).toFixed(2)}
              </Text>
            </View>
          )}

          <View style={styles.invoiceDivider} />

          <View style={[styles.invoiceRow, styles.invoiceTotalRow]}>
            <Text style={styles.invoiceTotalLabel}>TOTAL DUE</Text>
            <Text style={styles.invoiceTotalValue}>
              ${invoice?.final_price?.toFixed(2)}
            </Text>
          </View>

          <TouchableOpacity style={styles.payBtn} onPress={payNow}>
            <Text style={styles.payBtnText}>
              💳  PAY ${invoice?.final_price?.toFixed(2)}
            </Text>
          </TouchableOpacity>

          {!invoice?.stripe_payment_url && (
            <Text style={styles.invoiceNote}>
              (Stripe payment link unavailable — check server env)
            </Text>
          )}

          <TouchableOpacity style={styles.doneBtn} onPress={resetToCamera}>
            <Text style={styles.doneBtnText}>Done</Text>
          </TouchableOpacity>
        </ScrollView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
    padding: 24,
  },
  dim: { color: '#888' },
  heading: { color: '#fff', fontSize: 18, marginBottom: 16, textAlign: 'center' },
  button: {
    backgroundColor: '#fff',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  buttonText: { color: '#000', fontSize: 16, fontWeight: '600' },

  stage: { flex: 1, position: 'relative', backgroundColor: '#000' },
  camera: { flex: 1 },
  preview: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000' },
  previewImg: { width: '100%', height: '100%' },
  sticker: { position: 'absolute' },

  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlayText: { color: '#fff', fontSize: 18, marginTop: 12 },
  checkmark: { fontSize: 64 },

  readyOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  quoteText: { color: '#fff', fontSize: 22, fontWeight: '600', marginTop: 8 },
  finalizingText: { color: '#ccc', fontSize: 15, marginTop: 12 },
  barterBtn: {
    marginTop: 24,
    backgroundColor: '#ff5a87',
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 999,
  },
  barterBtnText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  barterBtnBusy: { opacity: 0.7 },
  dismissBtn: { marginTop: 16, paddingVertical: 10, paddingHorizontal: 20 },
  dismissBtnText: { color: '#bbb', fontSize: 14 },
  errText: {
    color: '#ff9090',
    fontSize: 13,
    marginTop: 16,
    textAlign: 'center',
  },

  controls: {
    height: 150,
    backgroundColor: '#111',
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 20,
  },
  shutter: {
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: '#fff',
    borderWidth: 4,
    borderColor: '#888',
  },
  shutterDisabled: { backgroundColor: '#666' },
  timings: { color: '#999', fontSize: 11, marginTop: 10 },

  // Invoice modal
  invoiceModal: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  invoiceContent: {
    padding: 28,
    paddingTop: 64,
    paddingBottom: 48,
  },
  invoiceHeader: {
    color: '#fff',
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: 2,
    textAlign: 'center',
  },
  invoiceSubtitle: {
    color: '#888',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 4,
    letterSpacing: 1,
  },
  invoiceDivider: {
    height: 1,
    backgroundColor: '#222',
    marginVertical: 20,
  },
  invoiceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  invoiceLabel: {
    color: '#888',
    fontSize: 14,
    flex: 1,
  },
  invoiceValue: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
    flex: 2,
    textAlign: 'right',
  },
  invoiceTotalRow: {
    marginBottom: 0,
  },
  invoiceTotalLabel: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    flex: 1,
  },
  invoiceTotalValue: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '800',
    flex: 2,
    textAlign: 'right',
  },
  payBtn: {
    marginTop: 36,
    backgroundColor: '#34c759',
    paddingVertical: 18,
    paddingHorizontal: 32,
    borderRadius: 16,
    alignItems: 'center',
  },
  payBtnText: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  invoiceNote: {
    color: '#555',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 10,
  },
  doneBtn: {
    marginTop: 24,
    alignItems: 'center',
    paddingVertical: 12,
  },
  doneBtnText: {
    color: '#555',
    fontSize: 16,
  },
});
