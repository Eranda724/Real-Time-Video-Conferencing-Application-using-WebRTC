const socket = io({
  transports: ["websocket", "polling"],
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
});
let localStream;
let screenStream = null;
let peerConnections = {};
let roomId;
let username;
let peerUsernames = {};
let isScreenSharing = false;
let isRecording = false;
let mediaRecorder = null;
let recordedChunks = [];

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const roomInput = document.getElementById("room");
const joinButton = document.getElementById("joinButton");
const micButton = document.getElementById("micButton");
const micIcon = document.getElementById("micIcon");
const cameraButton = document.getElementById("cameraButton");
const cameraIcon = document.getElementById("cameraIcon");
const screenShareButton = document.getElementById("screenShareButton");
const screenShareIcon = document.getElementById("screenShareIcon");
const chatbox = document.getElementById("chatbox");
const messageInput = document.getElementById("messageInput");
const sendButton = document.getElementById("sendButton");

const iceServers = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

async function joinRoom() {
  roomId = roomInput.value.trim();
  if (!roomId) {
    alert("Please enter a Room ID!");
    return;
  }

  if (!username) {
    username = prompt("Enter your name:") || "Guest";
  }

  try {
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

    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });

    localVideo.srcObject = localStream;

    let localVideoContainer = document.getElementById("local-video-container");
    if (!localVideoContainer) {
      localVideoContainer = document.createElement("div");
      localVideoContainer.id = "local-video-container";
      localVideoContainer.className = "video-container";
      localVideo.parentNode.insertBefore(localVideoContainer, localVideo);
      localVideoContainer.appendChild(localVideo);

      const localUsernameLabel = document.createElement("div");
      localUsernameLabel.className = "username-label";
      localUsernameLabel.textContent = username + " (You)";
      localVideoContainer.appendChild(localUsernameLabel);
    }

    if (localVideoContainer) {
      localVideoContainer.onclick = handleVideoClick;
    }

    socket.emit("join-room", roomId, username);

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

function createPeerConnection(userId) {
  if (peerConnections[userId]) {
    console.log(`Peer connection already exists for ${userId}`);
    return peerConnections[userId];
  }

  const peerConnection = new RTCPeerConnection(iceServers);

  peerConnection.onconnectionstatechange = () => {
    console.log(
      `Connection state with ${userId}:`,
      peerConnection.connectionState
    );
  };

  peerConnection.oniceconnectionstatechange = () => {
    console.log(
      `ICE connection state with ${userId}:`,
      peerConnection.iceConnectionState
    );
  };

  localStream.getTracks().forEach((track) => {
    peerConnection.addTrack(track, localStream);
  });

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      console.log(`Sending ICE candidate to ${userId}`);
      socket.emit("ice-candidate", event.candidate, userId);
    }
  };

  peerConnection.ontrack = (event) => {
    console.log(`Received track from ${userId}`);

    const existingContainer = document.getElementById(`container-${userId}`);
    if (existingContainer) {
      existingContainer.remove();
    }

    createVideoContainer(userId, event.streams[0]);
  };

  peerConnections[userId] = peerConnection;
  return peerConnection;
}

function toggleMic() {
  const audioTrack = localStream.getAudioTracks()[0];
  audioTrack.enabled = !audioTrack.enabled;

  if (audioTrack.enabled) {
    micIcon.src = "icons/mic-on.png";
  } else {
    micIcon.src = "icons/mic-off.png";
  }
}

function toggleCamera() {
  const videoTrack = localStream.getVideoTracks()[0];
  videoTrack.enabled = !videoTrack.enabled;

  if (videoTrack.enabled) {
    cameraIcon.src = "icons/camera-on.png";
  } else {
    cameraIcon.src = "icons/camera-off.png";
  }
}

async function toggleScreenShare() {
  try {
    if (!isScreenSharing) {
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });

      const videoTrack = screenStream.getVideoTracks()[0];
      Object.values(peerConnections).forEach((connection) => {
        const sender = connection
          .getSenders()
          .find((s) => s.track.kind === "video");
        if (sender) {
          sender.replaceTrack(videoTrack);
        }
      });

      document.getElementById("screenShareButton").classList.add("active");
      isScreenSharing = true;

      videoTrack.onended = () => {
        stopScreenSharing();
      };
    } else {
      stopScreenSharing();
    }
  } catch (error) {
    console.error("Error toggling screen share:", error);
    alert("Failed to start screen sharing. Please try again.");
  }
}

function stopScreenSharing() {
  if (screenStream) {
    screenStream.getTracks().forEach((track) => track.stop());
    screenStream = null;
  }

  if (localStream) {
    const videoTrack = localStream.getVideoTracks()[0];
    Object.values(peerConnections).forEach((connection) => {
      const sender = connection
        .getSenders()
        .find((s) => s.track.kind === "video");
      if (sender) {
        sender.replaceTrack(videoTrack);
      }
    });
  }

  document.getElementById("screenShareButton").classList.remove("active");
  isScreenSharing = false;
}

async function toggleRecording() {
  try {
    if (!isRecording) {
      const stream = isScreenSharing ? screenStream : localStream;
      if (!stream) {
        alert("Please start your camera or screen share first!");
        return;
      }

      const videoStream = new MediaStream();
      stream.getVideoTracks().forEach((track) => {
        videoStream.addTrack(track);
      });

      const mimeTypes = ["video/webm", "video/mp4", "video/mpeg"];

      let selectedMimeType = "";
      for (const mimeType of mimeTypes) {
        if (MediaRecorder.isTypeSupported(mimeType)) {
          selectedMimeType = mimeType;
          break;
        }
      }

      if (!selectedMimeType) {
        throw new Error("No supported MIME type found for recording");
      }

      mediaRecorder = new MediaRecorder(videoStream, {
        mimeType: selectedMimeType,
        videoBitsPerSecond: 2500000, // 2.5 Mbps
      });

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunks.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const fileExtension = selectedMimeType.includes("mp4") ? "mp4" : "webm";
        const blob = new Blob(recordedChunks, { type: selectedMimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.style.display = "none";
        a.href = url;
        a.download = `recording-${new Date().toISOString()}.${fileExtension}`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
          window.URL.revokeObjectURL(url);
        }, 100);
        recordedChunks = [];
      };

      mediaRecorder.start(1000);
      isRecording = true;
      document.getElementById("recordIcon").src = "icons/record.png";
      document.getElementById("recordButton").classList.add("active");
    } else {
      // Stop recording
      if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
      }
      isRecording = false;
      document.getElementById("recordIcon").src = "icons/record.png";
      document.getElementById("recordButton").classList.remove("active");
    }
  } catch (error) {
    console.error("Error toggling recording:", error);
    alert("Failed to start/stop recording. Please try again.");
  }
}

// End the call
function endCall() {
  if (isScreenSharing) {
    stopScreenSharing();
  }

  if (isRecording) {
    toggleRecording();
  }

  Object.values(peerConnections).forEach((connection) => {
    connection.close();
  });

  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
  }

  window.location.reload();
}

function sendMessage() {
  const message = messageInput.value.trim();
  if (!message) return;

  socket.emit("send-message", message);

  messageInput.value = "";
}

// Display a received message
function displayMessage(data) {
  const messageDiv = document.createElement("div");
  messageDiv.classList.add("message");

  if (data.senderId === socket.id) {
    messageDiv.classList.add("my-message");
  } else {
    messageDiv.classList.add("receiver-message");
  }

  messageDiv.textContent = `${data.user}: ${data.text}`;
  chatbox.appendChild(messageDiv);

  chatbox.scrollTop = chatbox.scrollHeight;
}

// Handle video container clicks for enlarging/shrinking
function handleVideoClick(event) {
  const clickedContainer = event.target.closest(".video-container");
  if (!clickedContainer) return;

  const videosContainer = document.getElementById("videos");
  const allContainers = document.querySelectorAll(".video-container");

  if (clickedContainer.classList.contains("enlarged")) {
    clickedContainer.classList.remove("enlarged");
    videosContainer.classList.remove("has-enlarged");
    allContainers.forEach((container) => {
      container.style.transition = "all 0.3s ease";
      container.classList.remove("small");
    });
  } else {
    allContainers.forEach((container) => {
      container.style.transition = "all 0.3s ease";
    });

    allContainers.forEach((container) => {
      container.classList.remove("enlarged");
    });

    clickedContainer.classList.add("enlarged");
    videosContainer.classList.add("has-enlarged");

    if (clickedContainer.parentNode.firstChild !== clickedContainer) {
      videosContainer.insertBefore(
        clickedContainer,
        videosContainer.firstChild
      );
    }
  }
}

// Modify the function that creates video elements to add click handlers
function createVideoContainer(userId, stream) {
  let videoContainer = document.getElementById(`container-${userId}`);

  if (!videoContainer) {
    videoContainer = document.createElement("div");
    videoContainer.id = `container-${userId}`;
    videoContainer.className = "video-container";
    videoContainer.onclick = handleVideoClick;

    const videoElement = document.createElement("video");
    videoElement.id = `remote-${userId}`;
    videoElement.autoplay = true;
    videoElement.playsInline = true;

    videoContainer.appendChild(videoElement);

    const usernameLabel = document.createElement("div");
    usernameLabel.className = "username-label";
    usernameLabel.textContent = peerUsernames[userId] || "User";
    videoContainer.appendChild(usernameLabel);

    document.getElementById("videos").appendChild(videoContainer);
  }

  const videoElement = videoContainer.querySelector("video");
  if (videoElement && videoElement.srcObject !== stream) {
    videoElement.srcObject = stream;
  }

  return videoContainer;
}

socket.on("user-connected", async (userId, userName) => {
  console.log(`User connected: ${userId} (${userName})`);
  peerUsernames[userId] = userName;

  try {
    const peerConnection = createPeerConnection(userId);
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    console.log(`Sending offer to ${userId}`);
    socket.emit("offer", offer, userId);
  } catch (error) {
    console.error("Error in user-connected handler:", error);
  }
});

socket.on("room-users", async (users) => {
  console.log("Existing users in room:", users);

  users.forEach((user) => {
    createPeerConnection(user.id);
  });
});

socket.on("offer", async (offer, senderId) => {
  console.log("Received offer from:", senderId);

  try {
    let peerConnection = peerConnections[senderId];
    if (!peerConnection) {
      peerConnection = createPeerConnection(senderId);
    }

    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    console.log(`Sending answer to ${senderId}`);
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

  if (peerConnections[userId]) {
    peerConnections[userId].close();
    delete peerConnections[userId];
  }

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
