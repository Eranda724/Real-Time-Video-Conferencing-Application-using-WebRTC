// Global variables
const socket = io({
  transports: ["websocket", "polling"],
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
});
let localStream;
let peerConnections = {}; // Store multiple peer connections
let roomId;
let username;
let peerUsernames = {};

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
    // Clean up existing connections and videos first
    Object.keys(peerConnections).forEach((userId) => {
      if (peerConnections[userId]) {
        peerConnections[userId].close();
        delete peerConnections[userId];
      }
      const oldVideo = document.getElementById(`remote-${userId}`);
      if (oldVideo) {
        oldVideo.remove();
      }
    });

    // Get local media stream
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });

    // Display local video
    localVideo.srcObject = localStream;

    // Create container for local video if not exists
    let localVideoContainer = document.getElementById("local-video-container");
    if (!localVideoContainer) {
      localVideoContainer = document.createElement("div");
      localVideoContainer.id = "local-video-container";
      localVideoContainer.className = "video-container";
      localVideo.parentNode.insertBefore(localVideoContainer, localVideo);
      localVideoContainer.appendChild(localVideo);

      // Add username label for local video
      const localUsernameLabel = document.createElement("div");
      localUsernameLabel.className = "username-label";
      localUsernameLabel.textContent = username + " (You)";
      localVideoContainer.appendChild(localUsernameLabel);
    }

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

  // Add connection state monitoring
  peerConnection.onconnectionstatechange = () => {
    console.log(
      `Connection state with ${userId}:`,
      peerConnection.connectionState
    );
  };

  // Add ICE connection state monitoring
  peerConnection.oniceconnectionstatechange = () => {
    console.log(
      `ICE connection state with ${userId}:`,
      peerConnection.iceConnectionState
    );
  };

  // Add local tracks to the connection
  localStream.getTracks().forEach((track) => {
    peerConnection.addTrack(track, localStream);
  });

  // Handle ICE candidates
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      console.log(`Sending ICE candidate to ${userId}`);
      socket.emit("ice-candidate", event.candidate, userId);
    }
  };

  // Handle incoming tracks (remote video/audio)
  peerConnection.ontrack = (event) => {
    console.log(`Received track from ${userId}`);

    // Remove any existing container for this user first
    const existingContainer = document.getElementById(`container-${userId}`);
    if (existingContainer) {
      existingContainer.remove();
    }

    // Create new video container
    const videoContainer = document.createElement("div");
    videoContainer.id = `container-${userId}`;
    videoContainer.className = "video-container";

    // Create video element
    const remoteVideoElement = document.createElement("video");
    remoteVideoElement.id = `remote-${userId}`;
    remoteVideoElement.autoplay = true;
    remoteVideoElement.playsInline = true;

    // Add video to container
    videoContainer.appendChild(remoteVideoElement);

    // Add username label
    const usernameLabel = document.createElement("div");
    usernameLabel.className = "username-label";
    usernameLabel.textContent = peerUsernames[userId] || "User";
    videoContainer.appendChild(usernameLabel);

    // Add container to videos grid
    document.getElementById("videos").appendChild(videoContainer);

    // Set the stream
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
  peerUsernames[userId] = userName; // Store the username

  try {
    const peerConnection = createPeerConnection(userId);
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    console.log(`Sending offer to ${userId}`);
    // Send the offer to the new user
    socket.emit("offer", offer, userId);
  } catch (error) {
    console.error("Error in user-connected handler:", error);
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

  try {
    // Get or create peer connection for this user
    let peerConnection = peerConnections[senderId];
    if (!peerConnection) {
      peerConnection = createPeerConnection(senderId);
    }

    // Set the remote description (their offer)
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

    // Create an answer
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    console.log(`Sending answer to ${senderId}`);
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

socket.on("user-disconnected", (userId, userName) => {
  console.log(`User ${userName} (${userId}) disconnected`);

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

  // Display a message in the chat that the user has left
  const messageDiv = document.createElement("div");
  messageDiv.classList.add("message", "system-message");
  messageDiv.textContent = `${userName} has left the room`;
  chatbox.appendChild(messageDiv);
  chatbox.scrollTop = chatbox.scrollHeight;
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
