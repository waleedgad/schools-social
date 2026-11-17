# Face models

Run on the Mac with ONNX Runtime. Nothing is sent anywhere.

- `face_detection_yunet_2023mar.onnx`: YuNet face detector, from OpenCV Zoo (MIT licence).
- `face_recognition_sface_2021dec.onnx`: SFace face recogniser, from OpenCV Zoo (Apache 2.0 licence).

Source: https://github.com/opencv/opencv_zoo
- `face_landmarks_detector.onnx` (478 points on a face) and `face_blendshapes.onnx` (52 expression strengths): Google MediaPipe Face Landmarker V2 and Blendshape V2, converted to ONNX. Licence: Apache 2.0, free for commercial use (stated in Google's model cards "Model Card MediaPipe Face Mesh V2" and "Model Card Blendshape V2", https://storage.googleapis.com/mediapipe-assets/). Source project: https://github.com/google-ai-edge/mediapipe. Used by `src/core/expression.ts` (eyes open, smile, turned away). Checked 17 Nov 2026. Limits per the cards: not for faces turned more than 80 degrees; does not identify anyone. Shipped in 0.12 on Waleed's decision; not used by a screen yet.
