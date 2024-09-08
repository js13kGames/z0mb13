import { vec2, drawRect, hsl, drawLine } from './libs/littlejs.esm.min.js';
import { makeBlood, makeFire, makeExplosion } from './effects.js';
import { sound_explode, sound_bat_hit } from './sound.js';
import { player, gameSettings, showComboMessage } from './main.js';
import { incrementScore, addCurrency } from './bullet.js';

const EXPLOSION_RADIUS = 4.3;
export const gameState = { gameOver: false };

export function setGameOver(value) {
    gameState.gameOver = value;
    return value;
}

let comboChains = [];
const MAX_CHAIN_DURATION = 3, COMBO_DISTANCE_THRESHOLD = 1;

function startComboChain(zombie) {
    comboChains.push({
        zombies: new Set([zombie]),
        startTime: Date.now(),
        lastZombiePosition: new vec2(zombie.pos.x, zombie.pos.y),
    });
}

function findNearestChain(zombie) {
    let nearestChain = null, shortestDistance = COMBO_DISTANCE_THRESHOLD;
    comboChains.forEach(chain => chain.zombies.forEach(z => {
        const distance = z.pos.distance(zombie.pos);
        if (distance < shortestDistance) {
            shortestDistance = distance;
            nearestChain = chain;
        }
    }));
    return nearestChain;
}

function finalizeComboChain(chain) {
    if (chain.zombies.size >= 2) {
        incrementScore(chain.zombies.size);
        showComboMessage(chain.zombies.size, chain.lastZombiePosition);
    }
}

function updateComboChains() {
    const currentTime = Date.now();
    comboChains = comboChains.filter(chain => {
        if ((currentTime - chain.startTime) / 1000 >= MAX_CHAIN_DURATION) {
            finalizeComboChain(chain);
            return false;
        }
        return true;
    });
}
setInterval(updateComboChains, 100);

export class Zombie {
    constructor(pos) {
        Object.assign(this, {
            pos: new vec2(pos.x, pos.y),
            speed: gameSettings.zombieSpeed,
            isDead: false,
            onFire: false,
            fadeOutTimer: 4,
            fireSpreadTimer: 1,
            armLength: 1.2 + Math.random() * 0.4,
            armThickness: 0.1,
            armOscillationSpeed: 0.016 + Math.random() * 0.02,
            time: Math.random() * 0.4,
            minArmAngle: Math.random() * Math.PI / 16 + Math.PI / 12,
            maxArmAngle: Math.random() * Math.PI / 18 + Math.PI / 18,
            armDelay: Math.random() * Math.PI,
            frameDelay: Math.floor(Math.random() * 20) + 10
        });
        this.frozenLeftArm = this.frozenRightArm = null;
    }

    update() {
        if (gameState.gameOver) return;
        if (this.isDead) this.handleDeathFadeOut();
        else if (this.onFire) this.handleFireState();
        else {
            this.checkFireSpread();
            this.moveTowardsPlayer();
        }
    }

    handleDeathFadeOut() {
        if (this.fadeOutTimer > 0) {
            this.fadeOutTimer -= 1 / 60;
            if (this.fadeOutTimer <= 0 && this.fireEmitter) this.fireEmitter.emitRate = 0;
        } else {
            this.fadeOutTimer = 0; // Set it to zero to prevent negative timer
        }
    }

    handleFireState() {
        if (this.fireSpreadTimer > 0) {
            this.spreadFire();
            this.fireSpreadTimer -= 1 / 60;
        } else {
            this.handleDeathFadeOut();
        }
    }

    checkFireSpread() {
        gameSettings.zombies.forEach(otherZombie => {
            if (otherZombie !== this && otherZombie.onFire && !this.onFire && !this.isDead && this.pos.distance(otherZombie.pos) < 1) {
                this.catchFire();
            }
        });
    }

    catchFire() {
        if (!this.onFire) {
            incrementScore(1);
            addCurrency(1);
            this.onFire = true;
            this.fireEmitter = makeFire(this.pos);
            const nearestChain = findNearestChain(this);
            nearestChain ? nearestChain.zombies.add(this) : startComboChain(this);
        }
    }

    spreadFire() {
        gameSettings.zombies.forEach(zombie => {
            if (zombie !== this && !zombie.isDead && this.pos.distance(zombie.pos) < 1) {
                zombie.catchFire();
            }
        });
    }

    moveTowardsPlayer() {
        if (!this.isDead && !this.onFire && this.fadeOutTimer > 0) {
            if (this.frameDelay > 0) this.frameDelay--;
            else this.time += this.armOscillationSpeed;

            this.avoidCollisions();
            this.pos = this.pos.add(player.pos.subtract(this.pos).normalize().scale(this.speed));
        }
    }

    avoidCollisions() {
        gameSettings.zombies.forEach(zombie => {
            if (zombie !== this && !zombie.isDead && this.pos.distance(zombie.pos) < 1) {
                this.pos = this.pos.add(this.pos.subtract(zombie.pos).normalize().scale(this.speed));
            }
        });
    }

    render() {
        let opacity = 1;
        if (this.isDead || (this.onFire && this.fadeOutTimer <= 4)) {
            opacity = Math.max(this.fadeOutTimer / 4, 0); // Ensures opacity doesn't go below zero
        }

        if (this.isDead) {
            drawRect(this.pos, vec2(1, 1), hsl(0, 0, 0.2, opacity));
        } else if (this.onFire) {
            drawRect(this.pos, vec2(1, 1), hsl(0.1, 1, 0.5, opacity)); 
        } else {
            drawRect(this.pos, vec2(1, 1), hsl(0.3, 1, 0.5));
        }

        this.renderArms(opacity);
    }

    renderArms(opacity) {
        if (this.isDead || this.onFire) {
            this.drawFrozenArm(this.frozenLeftArm, opacity);
            this.drawFrozenArm(this.frozenRightArm, opacity);
        } else {
            this.drawArm(1, opacity);
            this.drawArm(-1, opacity);
        }
    }

    drawFrozenArm(arm, opacity) {
        if (arm) {
            const armColor = this.onFire ? hsl(0.1, 1, 0.5, opacity) : hsl(0, 0, 0.2, opacity);
            drawLine(arm.upperStart, arm.upperEnd, this.armThickness, armColor);
            drawLine(arm.upperEnd, arm.foreEnd, this.armThickness, armColor);
        }
    }

    drawArm(side, opacity) {
        const directionToPlayer = player.pos.subtract(this.pos).normalize();
        const angleToPlayer = Math.atan2(directionToPlayer.y, directionToPlayer.x);
        const armBaseOffset = vec2(Math.cos(angleToPlayer + Math.PI / 2 * side), Math.sin(angleToPlayer + Math.PI / 2 * side)).scale(0.5);
        const basePos = this.pos.add(armBaseOffset);
        const upperArmLength = this.armLength * 0.5, forearmLength = this.armLength * 0.5;
        const upperArmAngle = angleToPlayer + Math.sin(this.time + this.armDelay) * (this.maxArmAngle - this.minArmAngle);
        const forearmAngle = upperArmAngle + Math.sin(this.time + this.armDelay + Math.PI / 4) * (this.maxArmAngle - this.minArmAngle);
        const upperArmEnd = basePos.add(vec2(Math.cos(upperArmAngle), Math.sin(upperArmAngle)).scale(upperArmLength));
        drawLine(basePos, upperArmEnd, this.armThickness, hsl(0.3, 1, 0.5, opacity));
        const forearmEnd = upperArmEnd.add(vec2(Math.cos(forearmAngle), Math.sin(forearmAngle)).scale(forearmLength));
        drawLine(upperArmEnd, forearmEnd, this.armThickness, hsl(0.3, 1, 0.5, opacity));
        if (side === 1) {
            this.frozenRightArm = { upperStart: basePos, upperEnd: upperArmEnd, foreEnd: forearmEnd };
        } else {
            this.frozenLeftArm = { upperStart: basePos, upperEnd: upperArmEnd, foreEnd: forearmEnd };
        }
    }

    startFadeOut() {
        this.fadeOutTimer = 4;
    }

    kill() {
        if (!this.isDead) {
            sound_bat_hit.play(this.pos);
            incrementScore();
            addCurrency(1);
            this.isDead = true;
            makeBlood(this.pos);
        }
    }
}
export class Boomer extends Zombie {
    constructor(pos) {
        super(pos);
        this.speed = gameSettings.zombieSpeed - 0.005;
        this.exploding = false;
        this.bloodEmitter = null;
        this.explosionEmitter = null;
        this.isFlickering = false; // Property to track flickering state
        this.flickerTimer = 0; // Timer to manage flickering duration
        this.flickerDuration = 2; // Total duration of the flickering effect

        // Arm properties for Boomer-like movement
        this.armLength = 1.2 + (Math.random() * 0.4); // Total length of each arm with random variation
        this.armThickness = 0.1; // Thickness of the arms
        this.armOscillationSpeed = 0.016 + (Math.random() * 0.02); // Speed of arm movement
        this.time = (Math.random() * 0.4); // Time to control animation

        // Ensure min and max arm angles have a meaningful difference
        this.minArmAngle = (Math.random() *  Math.PI / 16) + Math.PI / 12; // Randomized minimum angle for arm swing
        this.maxArmAngle = this.minArmAngle + (Math.random() *  Math.PI / 18) +  Math.PI / 18;  // Reduced maximum angle to make sway more subtle

        // Randomized delay for arm movement to prevent synchronization
        this.armDelay = Math.random() *  Math.PI; // Random delay to stagger arm movement
        this.frameDelay = Math.floor(Math.random() * 20) + 10; // Random frame delay between 10 to 30 frames

        // Frozen arm positions upon death
        this.frozenLeftArm = null;
        this.frozenRightArm = null;
    }

    // Override the catchFire method to start flickering before the explosion
    catchFire() {
        if (!this.onFire && !this.isDead) {
            this.onFire = true;
            this.speed = 0; // Stop Boomer movement when it catches fire
            this.fireEmitter = makeFire(this.pos); // Start the fire emitter

            // Start flickering and set a delay before explosion
            this.isFlickering = true;
            this.flickerTimer = 0;
        }
    }

    update() {
        if (gameState.gameOver) return;

        if (!this.isDead) {
            if (this.isFlickering) {
                this.updateFlickerState(); // Update flickering state
            }

            // Decrement the frame delay counter before starting the animation
            if (this.frameDelay > 0) {
                this.frameDelay--;
            } else {
                this.time += this.armOscillationSpeed; // Update time for arm animation after delay
            }

            super.update();
        } else {
            if (!this.exploding) {
                this.exploding = true;
                this.freezeArms(); // Freeze arms when Boomer starts exploding
                setTimeout(() => {
                    this.explode();
                }, 2000); // Explosion delay after death
            }
        }
    }

    boomerHitByBat() {
        if (!this.isFlickering && !this.isDead) {
            this.isFlickering = true;
            this.flickerTimer = 0; // Reset flicker timer
            sound_bat_hit.play(this.pos); // Play punch sound when hit
            this.speed = 0; // Stop Boomer movement when hit

            // Freeze the Boomer and its arms in place
            this.freezeArms();
        }
    }

    updateFlickerState() {
        this.flickerTimer += 1 / 60; // Increment the timer (assuming 60 FPS)
        if (this.flickerTimer >= this.flickerDuration) {
            this.isFlickering = false; // Stop flickering after duration ends
            this.explode(); // Trigger explosion after flickering ends
        }
    }

    explode() {
        // Stop the fire emitter if it's still running
        if (this.fireEmitter) {
            this.fireEmitter.emitRate = 0; // Stop fire effect
            this.fireEmitter = null; // Clean up reference
        }

        // Adds currency and effects
        addCurrency(1);
        this.bloodEmitter = makeBlood(this.pos, 10);
        this.explosionEmitter = makeExplosion(this.pos, 200);
        sound_explode.play(this.pos);

        // Initialize combo count for scoring
        let comboCount = 0;
        const comboThreshold = 3; // Minimum zombies for a combo

        // Iterate over all zombies to apply explosion effects
        gameSettings.zombies.forEach(zombie => {
            if (this.pos.distance(zombie.pos) < EXPLOSION_RADIUS) {
                // Damage or affect zombies that are within the blast radius
                if (zombie !== this && !zombie.isDead) {
                    if (typeof zombie.takeExplosionDamage === 'function') {
                        zombie.takeExplosionDamage(); // Damage zombie
                    }

                    // Ensure all zombies in range catch fire
                    if (!zombie.onFire) {
                        zombie.catchFire(); // Set zombie on fire
                    }

                    comboCount++; // Increase combo count for each affected zombie
                }
            }
        });

        // Handle combo scoring and messages
        if (comboCount >= comboThreshold) {
            incrementScore(1 * comboCount);
            const comboPosition = new vec2(this.pos.x, this.pos.y);
            showComboMessage(comboCount, comboPosition);
        }

        // Check if the player is within the blast radius
        if (this.pos.distance(player.pos) < EXPLOSION_RADIUS) {
            setGameOver(true); // End game if player is too close
        }

        // Clean up effects after a delay
        setTimeout(() => {
            addCurrency(1);
            if (this.bloodEmitter) this.bloodEmitter.emitRate = 0;
            if (this.explosionEmitter) this.explosionEmitter.emitRate = 0;
            this.exploding = false;
        }, 1000);

        this.deathTimer = 0; // Reset death timer
        this.isDead = true; // Set Boomer as dead
    }

    render() {
        let color;
        if (this.isDead) {
            if (this.exploding) {
                this.bombFlickerEffect(); // Flicker effect during explosion
                return;
            }
        } else if (this.isFlickering) {
            color = Math.random() > 0.5 ? hsl(0.6, 1, 0.5) : hsl(0, 0, 0.2); // Flicker between colors
        } else if (this.onFire) {
            color = hsl(0.1, 1, 0.5); // Burning color
        } else {
            color = hsl(0.6, 1, 0.5); // Normal Boomer color
        }

        drawRect(this.pos, vec2(1, 1), color);
        this.renderArms(color); // Render arms with appropriate color
    }

    renderArms(color) {
        if (this.isDead && this.exploding) {
            // Flash arms with the body
            this.drawFrozenArm(this.frozenLeftArm, color);
            this.drawFrozenArm(this.frozenRightArm, color);
        } else if (this.isDead || this.isFlickering) {
            // If Boomer is dead or flickering, use frozen arm positions
            this.drawFrozenArm(this.frozenLeftArm, color);
            this.drawFrozenArm(this.frozenRightArm, color);
        } else {
            // If Boomer is alive and not flickering, animate arms
            this.drawArm(1, color);  // Right arm
            this.drawArm(-1, color); // Left arm
        }
    }

    freezeArms() {
        // Freeze the current positions of the arms when Boomer is hit or explodes
        this.frozenLeftArm = this.getCurrentArmPosition(-1);
        this.frozenRightArm = this.getCurrentArmPosition(1);
    }

    getCurrentArmPosition(side) {
        // Calculate direction to player
        const directionToPlayer = player.pos.subtract(this.pos).normalize();
        const angleToPlayer = Math.atan2(directionToPlayer.y, directionToPlayer.x);

        // Adjust the base position for the arms to track the player
        const armBaseOffset = vec2(Math.cos(angleToPlayer + Math.PI / 2 * side), Math.sin(angleToPlayer + Math.PI / 2 * side)).scale(0.5);
        const basePos = this.pos.add(armBaseOffset);

        // Lengths of each arm segment
        const upperArmLength = this.armLength * 0.5;
        const forearmLength = this.armLength * 0.5;

        // Oscillate arm angles to create a boomer-like staggered effect
        const upperArmAngle = angleToPlayer + Math.sin(this.time + this.armDelay) * (this.maxArmAngle - this.minArmAngle);
        const forearmAngle = upperArmAngle + Math.sin(this.time + this.armDelay +  Math.PI / 4) * (this.maxArmAngle - this.minArmAngle);

        // Calculate end position of the upper arm
        const upperArmEnd = basePos.add(vec2(Math.cos(upperArmAngle), Math.sin(upperArmAngle)).scale(upperArmLength));

        // Calculate end position of the forearm
        const forearmEnd = upperArmEnd.add(vec2(Math.cos(forearmAngle), Math.sin(forearmAngle)).scale(forearmLength));

        // Return the calculated positions
        return { upperStart: basePos, upperEnd: upperArmEnd, foreEnd: forearmEnd };
    }

    drawFrozenArm(arm, color) {
        if (arm) {
            drawLine(arm.upperStart, arm.upperEnd, this.armThickness, color); // Use the color for the frozen arm
            drawLine(arm.upperEnd, arm.foreEnd, this.armThickness, color);
        }
    }

    drawArm(side, color) {
        // Calculate direction to player
        const directionToPlayer = player.pos.subtract(this.pos).normalize();
        const angleToPlayer = Math.atan2(directionToPlayer.y, directionToPlayer.x);

        // Adjust the base position for the arms to track the player
        const armBaseOffset = vec2(Math.cos(angleToPlayer +  Math.PI / 2 * side), Math.sin(angleToPlayer +  Math.PI / 2 * side)).scale(0.5);
        const basePos = this.pos.add(armBaseOffset);

        // Lengths of each arm segment
        const upperArmLength = this.armLength * 0.5;
        const forearmLength = this.armLength * 0.5;

        // Oscillate arm angles to create a boomer-like staggered effect
        const upperArmAngle = angleToPlayer + Math.sin(this.time + this.armDelay) * (this.maxArmAngle - this.minArmAngle);
        const forearmAngle = upperArmAngle + Math.sin(this.time + this.armDelay +  Math.PI / 4) * (this.maxArmAngle - this.minArmAngle);

        // Calculate end position of the upper arm
        const upperArmEnd = basePos.add(vec2(Math.cos(upperArmAngle), Math.sin(upperArmAngle)).scale(upperArmLength));
        drawLine(basePos, upperArmEnd, this.armThickness, color); // Draw upper arm

        // Calculate end position of the forearm
        const forearmEnd = upperArmEnd.add(vec2(Math.cos(forearmAngle), Math.sin(forearmAngle)).scale(forearmLength));
        drawLine(upperArmEnd, forearmEnd, this.armThickness, color); // Draw forearm

        // Save arm positions for freezing upon death
        if (side === 1) {
            this.frozenRightArm = { upperStart: basePos, upperEnd: upperArmEnd, foreEnd: forearmEnd };
        } else {
            this.frozenLeftArm = { upperStart: basePos, upperEnd: upperArmEnd, foreEnd: forearmEnd };
        }
    }

    bombFlickerEffect() {
        if (this.exploding) {
            const flickerColor = Math.random() > 0.5 ? hsl(0.6, 1, 0.5) : hsl(0, 0, 0.2);
            drawRect(this.pos, vec2(1, 1), flickerColor);
            // Flash the frozen arms with the body
            this.drawFrozenArm(this.frozenLeftArm, flickerColor);
            this.drawFrozenArm(this.frozenRightArm, flickerColor);
        }
    }
}
export class DeadlyDangler extends Zombie {
    constructor(pos) {
        super(pos); // Call the parent class constructor first

        // Initialize unique properties for DeadlyDangler
        this.tendrilLength = 2.5; // Length of the deadly tendrils
        this.legLength = 1.5; // Base length scale for tendrils
        this.legThickness = 0.1; // Thickness of the tendrils
        this.numLegsPerSide = 3; // Three tendrils per side
        this.animationSpeed = 0.1; // Speed of tendril movement
        this.legOffset =  Math.PI / 3; // Phase offset for tendril movement
        this.time = 0; // Time to control animation
        this.rotationSpeed = 0.05; // Speed of rotation toward the target direction
        this.movementSpeed = 0.02; // Speed of movement toward the player
        this.randomFactors = this.generateRandomFactors(); // Random factors for each tendril
    }
    catchFire() {
        if (!this.onFire && !this.isDead) { // Only catch fire if not already on fire and not dead
            this.onFire = true;
            this.fireEmitter = makeFire(this.pos); // Start the fire effect immediately
            this.fireSpreadTimer = 2; // Fire spread timer set for 2 seconds

            // Increment score and currency when the zombie catches fire
            incrementScore(1);
            addCurrency(1);

            // Add to the nearest combo chain or start a new one
            const nearestChain = findNearestChain(this);
            if (nearestChain) {
                addToComboChain(nearestChain, this);
            } else {
                startComboChain(this);
            }

            // Adjust behavior if needed (e.g., stop movement)
            this.speed = 0; // Stop the zombie from moving when it's on fire

            // Start fade out process when fire spreading is done
            setTimeout(() => {
                this.startFadeOut();
            }, this.fireSpreadTimer * 1000); // Start fade out after fire spread time
        }
    }
    generateRandomFactors() {
        // Generate random factors for each tendril's oscillation
        const randomFactors = [];
        for (let i = 0; i < this.numLegsPerSide * 2; i++) {
            randomFactors.push({
                phaseShift: Math.random() * 2 *  Math.PI, // Random phase shift between 0 and 2*PI
                amplitudeVariation: Math.random() * 0.2 + 0.9 // Random amplitude variation between 0.9 and 1.1
            });
        }
        return randomFactors;
    }

    update() {
        if (gameState.gameOver) return;

        if (this.frozen) {
            this.speed = 0;
            setTimeout(() => {
                this.frozen = false;
                this.speed = gameSettings.zombieSpeed;
            }, 3000);
        }

        // Fire handling for DeadlyDangler
        if (this.onFire && !this.isDead) {
            this.isDead = true;
            this.fireEmitter = makeFire(this.pos);

            gameSettings.zombies.forEach(otherZombie => {
                if (!otherZombie.isDead && this.pos.distance(otherZombie.pos) < 1 && !otherZombie.onFire) {
                    otherZombie.onFire = true;
                }
            });

            this.startFadeOut();
        }

        // If not dead, update movement and tendrils
        if (!this.isDead) {
            this.time += this.animationSpeed; // Update time for animation

            // Move towards the player
            const direction = player.pos.subtract(this.pos).normalize();
            this.pos = this.pos.add(direction.scale(this.movementSpeed));

            // Check for collision with tendrils
            if (this.checkTendrilCollision(player.pos)) {
                setGameOver(true); // Player is caught by the deadly tendrils
            }
        } else {
            // Handle fade-out if dead
            if (this.fadeOutTimer > 0) {
                this.fadeOutTimer -= 1 / 60;
                if (this.fadeOutTimer <= 0) {
                    this.deathTimer = 0;
                    if (this.fireEmitter) this.fireEmitter.emitRate = 0;
                }
            }
        }
    }

    checkTendrilCollision(playerPos) {
        // Check each tendril segment for collision with the player
        for (let side = -1; side <= 1; side += 2) { // -1 for left side, 1 for right side
            for (let i = 0; i < this.numLegsPerSide; i++) {
                if (this.checkTendrilSegmentCollision(side, i, playerPos)) {
                    return true; // Collision detected
                }
            }
        }
        return false; // No collision detected
    }

    checkTendrilSegmentCollision(side, index, playerPos) { // Check for collision within a single tendril or segment 
        // Adjust base position to start from left or right edge of the body
        const baseOffsetX = (1 / 2 + this.legThickness / 2) * side; // Move to left or right edge
        const baseOffsetY = (index - (this.numLegsPerSide - 1) / 2) * (1 / this.numLegsPerSide);
        const basePos = this.pos.add(vec2(baseOffsetX, baseOffsetY));

        // Define lengths for each tendril segment
        const lengths = {
            coxa: this.legLength * 0.3,
            trochanter: this.legLength * 0.2,
            femur: this.legLength * 0.6,
            patella: this.legLength * 0.4,
            tibia: this.legLength * 0.5,

        };

        // Retrieve random factors for this tendril
        const legIndex = index + (side === 1 ? this.numLegsPerSide : 0);
        const { phaseShift, amplitudeVariation } = this.randomFactors[legIndex];

        // Calculate direction towards the player
        const directionToPlayer = player.pos.subtract(this.pos).normalize();
        const targetAngle = Math.atan2(directionToPlayer.y, directionToPlayer.x);

        // Base angle movement for trailing tendril effect with added randomness
        const t = (this.time + index * this.legOffset + phaseShift) % (2 *  Math.PI);

        // Angles for each segment, adjusted to point towards the player
        const angles = {
            coxa: targetAngle + Math.sin(t) *  Math.PI / 12 * side * amplitudeVariation,
            trochanter: targetAngle + Math.sin(t +  Math.PI / 8) * Math.PI / 16 * side * amplitudeVariation,
            femur: targetAngle + Math.sin(t +  Math.PI / 4) *  Math.PI / 10 * side * amplitudeVariation,
            patella: targetAngle + Math.sin(t +  Math.PI / 3) *  Math.PI / 8 * side * amplitudeVariation,
            tibia: targetAngle + Math.sin(t +  Math.PI / 2) *  Math.PI / 6 * side * amplitudeVariation,

        };

        // Calculate positions for each segment's end point and check for collision
        let currentPos = basePos;
        for (const [key, length] of Object.entries(lengths)) {
            const angle = angles[key];
            const nextPos = currentPos.add(vec2(Math.cos(angle), Math.sin(angle)).scale(length));

            // Check if the player is close to the current segment of the tendril
            if (this.isPointNearSegment(playerPos, currentPos, nextPos, this.legThickness)) {
                return true; // Collision detected
            }

            currentPos = nextPos; // Move to the next position
        }

        return false; // No collision detected with any segment
    }

    isPointNearSegment(point, start, end, radius) {
        // Calculate the distance from the point to the line segment
        const lineVec = end.subtract(start);
        const pointVec = point.subtract(start);
        const lineLength = lineVec.length();
        const lineDirection = lineVec.normalize();
        const projectionLength = pointVec.dot(lineDirection);

        // Clamp projection length to be within the segment
        const clampedProjection = Math.max(0, Math.min(projectionLength, lineLength));
        const closestPoint = start.add(lineDirection.scale(clampedProjection));
        const distanceToPoint = closestPoint.subtract(point).length();

        // Check if the distance to the closest point on the line segment is within the radius
        return distanceToPoint <= radius;
    }

    render() {
        // Calculate the opacity for fading out effect
        let opacity = 1;
        if (this.fadeOutTimer > 0) {
            opacity = this.fadeOutTimer / 4; // Adjust opacity based on the fade-out timer
        }

        // Determine the body color
        let color;
        if (this.isDead) {
            if (this.onFire) {
                color = hsl(0.1, 1, 0.5, opacity); // Burning color (orange) if on fire
            } else {
                color = hsl(0, 0, 0.2, opacity); // Grey when dead and not on fire
            }
        } else {
            color = hsl(0.3, 1, 0.5, opacity); // Normal color (green) when alive and not on fire
        }

        // Render the zombie base with fading effect
        drawRect(this.pos, vec2(1, 1), color);

        // Render the tendrils with the same fading effect
        for (let side = -1; side <= 1; side += 2) { // -1 for left side, 1 for right side
            for (let i = 0; i < this.numLegsPerSide; i++) {
                this.drawTendril(side, i, opacity);
            }
        }
    }

    drawTendril(side, index, opacity) {
        // Adjust base position to start from left or right edge of the body
        const baseOffsetX = (1 / 2 + this.legThickness / 2) * side; // Move to left or right edge
        const baseOffsetY = (index - (this.numLegsPerSide - 1) / 2) * (1 / this.numLegsPerSide);
        const basePos = this.pos.add(vec2(baseOffsetX, baseOffsetY));
    
        // Simplified segment lengths for the tendril
        const segmentLengths = [0.3, 0.2, 0.6, 0.4, 0.5].map(factor => this.legLength * factor);
    
        // Calculate direction to the player or retain the last angle if dead
        const directionToPlayer = player.pos.subtract(this.pos).normalize();
        const targetAngle = this.isDead ? this.lastTargetAngle : Math.atan2(directionToPlayer.y, directionToPlayer.x);
    
        // Save last angle if alive
        if (!this.isDead) this.lastTargetAngle = targetAngle;
    
        // Base angle and tendril sway effect
        const t = (this.time + index * this.legOffset + this.randomFactors[index].phaseShift) % (2 * Math.PI);
    
        // Set color based on state (alive, on fire, dead)
        const color = this.getTendrilColor(opacity);
    
        // Loop through each segment and draw it
        let currentPos = basePos;
        for (let i = 0; i < segmentLengths.length; i++) {
            const segmentAngle = targetAngle + Math.sin(t + i * Math.PI / 8) * side * this.randomFactors[index].amplitudeVariation;
            const nextPos = currentPos.add(vec2(Math.cos(segmentAngle), Math.sin(segmentAngle)).scale(segmentLengths[i]));
    
            drawLine(currentPos, nextPos, this.legThickness, color); // Draw the tendril segment
            currentPos = nextPos; // Move to next position
        }
    }
    
    // Helper function to determine the tendril color based on the DeadlyDangler's state
    getTendrilColor(opacity) {
        if (this.isDead) {
            return this.onFire ? hsl(0.1, 1, 0.5, opacity) : hsl(0, 0, 0.2, opacity);
        }
        return this.onFire ? hsl(0.1, 1, 0.5, opacity) : hsl(0, 1, 0.5, opacity);
    }
}