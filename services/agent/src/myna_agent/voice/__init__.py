"""Browser voice: Pipecat (WebRTC) + Sarvam Saaras (speech-to-text) + Bulbul (text-to-speech).

The voice layer never decides anything. Each final transcript is one caller turn, handed to the
same `/v1/calls/{id}/turns` logic Hawk and the web chat use, and the reply (a fixed template, not
generated speech) is what Bulbul speaks.
"""
