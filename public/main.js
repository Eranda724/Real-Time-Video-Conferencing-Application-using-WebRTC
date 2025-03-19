// Global variables
const socket = io();
let localStream;
let peerConnections = {}; // Store multiple peer connections
let roomId;
let username;

// DOM Elements
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const roomInput = document.getElementById("room");
const joinButton = document.getElementById("joinButton");
const micButton = document.getElementById("micButton");
const micIcon = document.getElementById("micIcon");
const cameraButton = document.getElementById("cameraButton");
const cameraIcon = document.getElementById("cameraIcon");
const chatbox = document.getElementById("chatbox");
const messageInput = document.getElementById("messageInput");
const sendButton = document.getElementById("sendButton");

// ICE servers configuration (STUN/TURN)
const iceServers = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

// Join a room
async function joinRoom() {
  roomId = roomInput.value.trim();
  if (!roomId) {
    alert("Please enter a Room ID!");
    return;
  }

  // Ask for username if not already set
  if (!username) {
    username = prompt("Enter your name:") || "Guest";
  }

  try {
    // Get local media stream
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });

    // Display local video
    localVideo.srcObject = localStream;

    // Join the room
    socket.emit("join-room", roomId, username);

    // Show UI elements
    document.getElementById("controls").style.display = "flex";
    document.getElementById("chat").style.display = "flex";
    joinButton.disabled = true;
    roomInput.disabled = true;

    console.log("Joined room:", roomId);
  } catch (error) {
    console.error("Error accessing media devices:", error);
    alert("Could not access camera or microphone. Please check permissions.");
  }
}

// Create a peer connection for a new user
function createPeerConnection(userId) {
  // Create new RTCPeerConnection
  const peerConnection = new RTCPeerConnection(iceServers);

  // Add local tracks to the connection
  localStream.getTracks().forEach((track) => {
    peerConnection.addTrack(track, localStream);
  });

  // Handle ICE candidates
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("ice-candidate", event.candidate, userId);
    }
  };

  // Handle incoming tracks (remote video/audio)
  peerConnection.ontrack = (event) => {
    // Create a new video element for this peer
    const remoteVideoElement = document.createElement("video");
    remoteVideoElement.id = `remote-${userId}`;
    remoteVideoElement.autoplay = true;
    remoteVideoElement.playsInline = true;

    // Add to the videos container
    document.getElementById("videos").appendChild(remoteVideoElement);
    remoteVideoElement.srcObject = event.streams[0];
  };

  // Store the connection
  peerConnections[userId] = peerConnection;
  return peerConnection;
}

// Toggle microphone
function toggleMic() {
  const audioTrack = localStream.getAudioTracks()[0];
  audioTrack.enabled = !audioTrack.enabled;

  if (audioTrack.enabled) {
    micIcon.src = "icons/mic-on.png";
  } else {
    micIcon.src = "icons/mic-off.png";
  }
}

// Toggle camera
function toggleCamera() {
  const videoTrack = localStream.getVideoTracks()[0];
  videoTrack.enabled = !videoTrack.enabled;

  if (videoTrack.enabled) {
    cameraIcon.src = "icons/camera-on.png";
  } else {
    cameraIcon.src = "icons/camera-off.png";
  }
}

// End the call
function endCall() {
  // Close all peer connections
  Object.values(peerConnections).forEach((connection) => {
    connection.close();
  });

  // Stop all local tracks
  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
  }

  // Refresh the page
  window.location.reload();
}

// Send a chat message
function sendMessage() {
  const message = messageInput.value.trim();
  if (!message) return;

  // Send to server
  socket.emit("send-message", message);

  // Clear input
  messageInput.value = "";
}

// Display a received message
function displayMessage(data) {
  const messageDiv = document.createElement("div");
  messageDiv.classList.add("message");

  // Style differently if it's our own message
  if (data.senderId === socket.id) {
    messageDiv.classList.add("my-message");
  } else {
    messageDiv.classList.add("receiver-message");
  }

  messageDiv.textContent = `${data.user}: ${data.text}`;
  chatbox.appendChild(messageDiv);

  // Auto-scroll to the bottom
  chatbox.scrollTop = chatbox.scrollHeight;
}

// Socket event handlers
socket.on("user-connected", async (userId, userName) => {
  console.log(`User connected: ${userId} (${userName})`);

  // Create peer connection for the new user
  const peerConnection = createPeerConnection(userId);

  try {
    // Create an offer
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    // Send the offer to the new user
    socket.emit("offer", offer, userId);
  } catch (error) {
    console.error("Error creating offer:", error);
  }
});

socket.on("room-users", async (users) => {
  console.log("Existing users in room:", users);

  // For each existing user, create a peer connection
  // The actual connection will be established when they send us an offer
  users.forEach((user) => {
    createPeerConnection(user.id);
  });
});

socket.on("offer", async (offer, senderId) => {
  console.log("Received offer from:", senderId);

  // Get or create peer connection for this user
  let peerConnection = peerConnections[senderId];
  if (!peerConnection) {
    peerConnection = createPeerConnection(senderId);
  }

  try {
    // Set the remote description (their offer)
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

    // Create an answer
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    // Send the answer back
    socket.emit("answer", answer, senderId);
  } catch (error) {
    console.error("Error handling offer:", error);
  }
});

socket.on("answer", async (answer, senderId) => {
  console.log("Received answer from:", senderId);

  const peerConnection = peerConnections[senderId];
  if (peerConnection) {
    try {
      await peerConnection.setRemoteDescription(
        new RTCSessionDescription(answer)
      );
    } catch (error) {
      console.error("Error handling answer:", error);
    }
  }
});

socket.on("ice-candidate", async (candidate, senderId) => {
  console.log("Received ICE candidate from:", senderId);

  const peerConnection = peerConnections[senderId];
  if (peerConnection) {
    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.error("Error adding ICE candidate:", error);
    }
  }
});

socket.on("user-disconnected", (userId) => {
  console.log("User disconnected:", userId);

  // Close the peer connection
  if (peerConnections[userId]) {
    peerConnections[userId].close();
    delete peerConnections[userId];
  }

  // Remove their video element
  const remoteVideo = document.getElementById(`remote-${userId}`);
  if (remoteVideo) {
    remoteVideo.remove();
  }
});

socket.on("receive-message", (data) => {
  displayMessage(data);
});

// Add event listener for Enter key in message input
messageInput.addEventListener("keypress", (event) => {
  if (event.key === "Enter") {
    sendMessage();
  }
});
