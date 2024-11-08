import { startTone, TONE_CDMA_ONE_MIN_BEEP } from "@mgcrea/react-native-tone-generator";
import * as FileSystem from "expo-file-system";
import * as SplashScreen from "expo-splash-screen";
import * as SQLite from "expo-sqlite";
import { useEffect, useRef, useState } from "react";
import "react-native-reanimated";

import { BarcodeScanningResult, CameraView, useCameraPermissions } from "expo-camera";
import * as Sharing from "expo-sharing";
import { Button, StyleSheet, Text, View } from "react-native";

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

export default function RootLayout() {
    const [permission, requestPermission] = useCameraPermissions();
    const cameraViewRef = useRef<CameraView>(null);
    const [paused, setPaused] = useState(false);
    const [codesRead, setCodesRead] = useState<number>(0);
    const [db, setDb] = useState<SQLite.SQLiteDatabase | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [canShare, setCanShare] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);
    const [dbFileUri, setDbFileUri] = useState<string | null>(null);

    useEffect(() => {
        if (db) return;
        FileSystem.getInfoAsync(FileSystem.documentDirectory + "SQLite/barcodes").then((r) => {
            console.log(r);
            setDbFileUri(r.uri);
        });
        Sharing.isAvailableAsync()
            .then((r) => setCanShare(r))
            .then(() => {
                console.log("Opening database");
                SQLite.openDatabaseAsync("barcodes").then((r) => {
                    // ensure the table exists
                    console.log("Ensuring table");
                    r.runAsync("CREATE TABLE IF NOT EXISTS barcodes (code TEXT PRIMARY KEY UNIQUE)").then(() =>
                        r.getAllAsync<{ code: string }>("SELECT code FROM barcodes").then((codes) => {
                            console.log(`Database opened, found ${codes.length} existing codes`);
                            setDb(r);
                            setCodesRead(codes.length);
                            setIsLoading(false);
                        })
                    );
                });
            });
    }, []);

    if (!permission || !db || isLoading) {
        // Camera permissions are still loading.
        return (
            <View>
                <Text>Loading...</Text>
            </View>
        );
    }

    if (!canShare) {
        return (
            <View>
                <Text>Sharing not available</Text>
            </View>
        );
    }

    if (!permission.granted) {
        // Camera permissions are not granted yet.
        return (
            <View style={styles.container}>
                <Text style={styles.message}>We need your permission to show the camera</Text>
                <Button onPress={requestPermission} title="grant permission" />
            </View>
        );
    }

    async function barcodeScannedCallback(result: BarcodeScanningResult) {
        setMsg(null);
        if (paused) return;
        cameraViewRef.current?.pausePreview();
        setPaused(true);
        console.log(`Barcode scanned`, result.data);
        startTone(TONE_CDMA_ONE_MIN_BEEP, 200);
        // ensure the code is unique
        const existing = await db!.getFirstAsync<{ code: string }>("SELECT code FROM barcodes WHERE code = ?", [
            result.data,
        ]);
        if (existing) {
            console.log("Code already exists");
            setMsg("Code already exists");
            await delay(2000);
            cameraViewRef.current?.resumePreview();
            setPaused(false);
            return;
        }
        // insert code
        await db!.runAsync("INSERT INTO barcodes (code) VALUES (?)", [result.data]);
        setCodesRead((prev) => prev + 1);

        await delay(2000);
        cameraViewRef.current?.resumePreview();
        setPaused(false);
        setMsg(`Scanned code ${result.data}`);
    }

    async function shareDatabase() {
        if (!dbFileUri) {
            setMsg("Database file not found");
            return;
        }
        try {
            await Sharing.shareAsync(dbFileUri, {
                mimeType: "application/x-sqlite3",
                dialogTitle: "Share database",
                UTI: "public.database",
            });
        } catch (e) {
            console.error(e);
        }
    }

    return (
        <View style={styles.container}>
            <CameraView
                ref={cameraViewRef}
                style={styles.camera}
                facing="back"
                barcodeScannerSettings={{
                    barcodeTypes: ["datamatrix"],
                }}
                onBarcodeScanned={barcodeScannedCallback}
            >
                <View style={styles.container2}>
                    <View>
                        <Text style={styles.text}>{codesRead} code stored</Text>
                    </View>

                    <View>{msg && <Text style={styles.text}>{msg}</Text>}</View>

                    <View>{paused && <Text style={styles.text}>Processing...</Text>}</View>
                </View>

                <View style={styles.buttonContainer}>
                    {/* button to clear all codes */}
                    <View style={styles.button}>
                        <Button
                            onPress={() => {
                                db.runAsync("DELETE FROM barcodes").then(() => setCodesRead(0));
                            }}
                            title="Clear"
                        />
                    </View>

                    <View style={styles.button}>
                        <Button
                            onPress={() => {
                                // delete db
                                db.runAsync("DROP TABLE barcodes").then(() =>
                                    db
                                        .runAsync("CREATE TABLE IF NOT EXISTS barcodes (code TEXT PRIMARY KEY UNIQUE)")
                                        .then(() => setCodesRead(0))
                                );
                            }}
                            title="Delete DB"
                        />
                    </View>

                    <View style={styles.button}>
                        <Button onPress={shareDatabase} title="Export" />
                    </View>
                </View>
            </CameraView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: "center",
    },
    container2: {
        flex: 1,
        flexDirection: "column",
        backgroundColor: "transparent",
        margin: 64,
    },
    message: {
        textAlign: "center",
        paddingBottom: 10,
    },
    camera: {
        flex: 1,
    },
    buttonContainer: {
        flex: 1,
        flexDirection: "row",
        backgroundColor: "transparent",
        margin: 64,
    },
    button: {
        flex: 1,
        alignSelf: "flex-end",
        alignItems: "center",
    },
    text: {
        fontSize: 24,
        fontWeight: "bold",
        color: "white",
    },
});
