/**
 * Created by wyao on 2017-01-22.
 */

var game = new Phaser.Game(360, 640, Phaser.AUTO);

var gameOptions = {
    // gameWidth: 600,
    // gameHeight: 1000,
    tileSize: 50,
    fieldSize: {
        rows: 6,
        cols: 6
    }
}

var defaultLevel = [
    [0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0]
];

var levels = [
    {
        level:[
            [0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0]
        ],
        playerPos: new Phaser.Point(5, 2)
    },
];

var upKey;
var downKey;
var leftKey;
var rightKey;

var olaf;

var olafTween;

var moving = false;

var timer;
var score = 0;
var scoreText;

var loadingText;

var gameOn = false;

var GameState = {
    preload: function () {
        this.load.audio('sing', 'assets/sounds/sing.mp3');
        this.load.audio('move', 'assets/sounds/move.mp3');
        this.load.audio('game-over', 'assets/sounds/game-over.mp3');
        this.load.image('background', 'assets/images/Island.png');
        this.load.image('olaf', 'assets/images/olaf.png');
        this.load.image('tile', 'assets/images/Tile.png');
        this.load.image('up', 'assets/images/up.png');
        this.load.image('down', 'assets/images/down.png');
        this.load.image('left', 'assets/images/left.png');
        this.load.image('right', 'assets/images/right.png');
        this.load.image('crack', 'assets/images/crack.png');
        this.load.image('lava', 'assets/images/lava.png');
        this.load.image('normal', 'assets/images/normal.png');
        this.load.image('hover', 'assets/images/hover.png');
        this.load.spritesheet('sound-button', 'assets/images/sound-button.png', 40, 40);
        this.load.spritesheet('restart', 'assets/images/restart.png', 160, 84);
        this.load.spritesheet("tiles", "assets/images/Tile.png", gameOptions.tileSize, gameOptions.tileSize);
        this.load.image("over-menu", "assets/images/game-over-menu.png");
        loadingText = game.add.text(game.world.centerX - 100, game.world.centerY - 300, 'Loading...', {font:"bold 50px", color: "black", align: "center"});
    },
    create: function () {
        this.background = this.game.add.sprite(0, 0, 'background');
        this.music = game.add.audio('sing', 0.7, true);
        this.music.play();
        this.move = game.add.audio('move');
        this.gameOverMusic = game.add.audio('game-over');
        this.createGame();
        this.addMenu();
        this.scale.scaleMode = Phaser.ScaleManager.SHOW_ALL;
        game.input.onDown.add(this.goLarge, this);
    },

    goLarge: function() {
        game.scale.startFullScreen();
    },

    update: function () {
        if (gameOn) {
            this.checkOlaf();
        }
    },

    render: function() {

    },

    createGame: function () {
        this.tilesArray = [];
        this.tileGroup = game.add.group();
        this.crackGroup = game.add.group();
        this.lavaGroup = game.add.group();
        this.buttonGroup = game.add.group();
        this.menuGroup = game.add.group();

        //this.tileGroup.x = (game.width - gameOptions.tileSize * gameOptions.fieldSize.cols) / 2;
        //this.tileGroup.y = (game.height -  gameOptions.tileSize * gameOptions.fieldSize.rows) / 2;
        for (var i = 0; i < gameOptions.fieldSize.rows; i++) {
            this.tilesArray[i] = [];
            for (var j = 0; j < gameOptions.fieldSize.cols; j++) {
                this.addTile(i, j, levels[0].level[i][j]);
            }
        }

        //Create Olaf
        olaf = this.game.add.sprite(gameOptions.tileSize / 2, gameOptions.tileSize / 2, 'olaf');
        //olaf.anchor.setTo(0.5);

        //Create Play Buttons
        this.addPlayButtons();
        this.addKeyboard();

        this.resumeGame();
    },

    resumeGame: function() {
        this.music.resume();
        this.gameOverMusic.stop();
        this.resetLevel();

        olaf.visible = true;
        olaf.x = gameOptions.tileSize / 2;
        olaf.y = gameOptions.tileSize / 2;

        this.tileGroup.visible = true;
        this.buttonGroup.visible = true;

        game.time.events.start();

        //Create Enemy
        this.addEnemy();

        score = 0;
        //Create Score Counter
        this.addScore();

        gameOn = true;
    },

    resetLevel: function() {
        levels[0].level = [
            [0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0]
        ];

        // for (var i = 0; i < gameOptions.rows; i++) {
        //     levels[0].level.push(new Array.apply(null, Array(gameOptions.cols)).map(Number.prototype.valueOf,0));
        // }
    },

    addTile: function (row, col, val) {
        var tileXPos = col * gameOptions.tileSize + gameOptions.tileSize / 2;
        var tileYPos = row * gameOptions.tileSize + gameOptions.tileSize / 2;

        var theTile = this.game.add.sprite(tileXPos, tileYPos, "tile");
        //theTile.anchor.setTo(0.5);
        theTile.tileValue = val;
        theTile.tilePosition = new Phaser.Point(col, row);
        this.tilesArray[row][col] = theTile;
        this.tileGroup.add(theTile);
    },

    addPlayButtons: function () {
        this.up = this.game.add.button(game.world.centerX, game.world.centerY + 70, 'up');
        this.up.anchor.setTo(0.5);
        this.up.scale.setTo(1.3);
        this.buttonGroup.add(this.up);
        this.down = this.game.add.button(game.world.centerX, game.world.centerY + 190, 'down');
        this.down.anchor.setTo(0.5);
        this.down.scale.setTo(1.3);
        this.buttonGroup.add(this.down);
        this.left = this.game.add.button(game.world.centerX - 80, game.world.centerY + 130, 'left');
        this.left.anchor.setTo(0.5);
        this.left.scale.setTo(1.3);
        this.buttonGroup.add(this.left);
        this.right = this.game.add.button(game.world.centerX + 80, game.world.centerY + 130, 'right');
        this.right.anchor.setTo(0.5);
        this.right.scale.setTo(1.3);
        this.buttonGroup.add(this.right);

        this.soundButton = this.game.add.button(game.world.centerX + 125, game.world.centerY + 25, 'sound-button', this.toggleMusic, this, 1, 1, 0);
        this.soundButton.anchor.setTo(0.5)
        this.buttonGroup.add(this.soundButton);
    },

    addKeyboard: function () {
        olafTween = game.add.tween(olaf);

        upKey = game.input.keyboard.addKey(Phaser.Keyboard.UP);
        downKey = game.input.keyboard.addKey(Phaser.Keyboard.DOWN);
        leftKey = game.input.keyboard.addKey(Phaser.Keyboard.LEFT);
        rightKey = game.input.keyboard.addKey(Phaser.Keyboard.RIGHT);

        upKey.onDown.add(this.addUpKey, this);
        downKey.onDown.add(this.addDownKey, this);
        leftKey.onDown.add(this.addLeftKey, this);
        rightKey.onDown.add(this.addRightKey, this);


        this.up.onInputDown.add(this.addUpKey, this);
        this.down.onInputDown.add(this.addDownKey, this);
        this.left.onInputDown.add(this.addLeftKey, this);
        this.right.onInputDown.add(this.addRightKey, this);

        olafTween.onStart.add(function() {
            moving = true;
        });

        // key1 = game.input.keyboard.addKey(Phaser.Keyboard.ONE);
        // key2 = game.input.keyboard.addKey(Phaser.Keyboard.ONE);
        // key3 = game.input.keyboard.addKey(Phaser.Keyboard.ONE);
        // key4 = game.input.keyboard.addKey(Phaser.Keyboard.ONE);
    },

    addUpKey: function() {
        this.move.play();
        if (olaf.y > gameOptions.tileSize / 2 && moving == false) {
            olafTween = game.add.tween(olaf).to({
                y: olaf.y - 50
            }, 40, Phaser.Easing.Linear.None);
            olafTween.start();
            olafTween.onStart.add(function() {
                moving = true;
            });
            olafTween.onComplete.add(function() {
                moving = false;
            });
        }
    },

    addDownKey: function() {
        this.move.play();
        if (olaf.y < gameOptions.tileSize / 2 * 10  && moving == false) {
            olafTween = game.add.tween(olaf).to({
                y: olaf.y + 50
            }, 40, Phaser.Easing.Linear.None);
            olafTween.start();
            olafTween.onStart.add(function() {
                moving = true;
            });
            olafTween.onComplete.add(function() {
                moving = false;
            });
        }

    },

    addLeftKey: function() {
        this.move.play();
        if (olaf.x > gameOptions.tileSize / 2  && moving == false) {
            olafTween = game.add.tween(olaf).to({
                x: olaf.x - 50
            }, 40, Phaser.Easing.Linear.None);
            olafTween.start();
            olafTween.onStart.add(function() {
                moving = true;
            });
            olafTween.onComplete.add(function() {
                moving = false;
            });
        }
    },

    addRightKey: function() {
        this.move.play();
        if (olaf.x < gameOptions.tileSize / 2 * 10  && moving == false) {
            olafTween = game.add.tween(olaf).to({
                x: olaf.x + 50
            }, 40, Phaser.Easing.Linear.None);
            olafTween.start();
            olafTween.onStart.add(function() {
                moving = true;
            });
            olafTween.onComplete.add(function() {
                moving = false;
            });
        }
    },

    addEnemy: function() {
        game.time.events.loop(Phaser.Timer.SECOND, this.addCrack, this);

        game.time.events.loop(Phaser.Timer.SECOND * 2, function() {
            game.time.events.loop(Phaser.Timer.SECOND, this.addCrack, this);
        }, this);
    },

    addCrack: function() {
        var lavaX = Math.floor((Math.random() * 6) + 1);
        var lavaY = Math.floor((Math.random() * 6) + 1);

        console.log('adding enemy');
        var crack = this.game.add.sprite(lavaX * gameOptions.tileSize, lavaY * gameOptions.tileSize, 'crack');
        crack.anchor.setTo(0.5);
        this.crackGroup.add(crack);

        game.time.events.add(Phaser.Timer.SECOND, function() {
            var lava = this.game.add.sprite(lavaX * gameOptions.tileSize, lavaY * gameOptions.tileSize, 'lava');
            lava.anchor.setTo(0.5);
            this.lavaGroup.add(lava);
            levels[0].level[lavaY - 1][lavaX - 1] = 1;
            crack.destroy();
            game.time.events.add(Phaser.Timer.SECOND * 0.6, function() {
                lava.destroy();
                levels[0].level[lavaY - 1][lavaX - 1] = 0;
            }, this);
        }, this);

    },

    checkOlaf: function() {
        var checkX = Math.floor((olaf.x - gameOptions.tileSize / 2) / gameOptions.tileSize);
        var checkY = Math.floor((olaf.y - gameOptions.tileSize / 2) / gameOptions.tileSize);
        if (levels[0].level[checkY][checkX] == 1){
            console.log("─────────▄▄───────────────────▄▄──");
            console.log("──────────▀█───────────────────▀█─");
            console.log("──────────▄█───────────────────▄█─");
            console.log("──█████████▀───────────█████████▀─");
            console.log("───▄██████▄─────────────▄██████▄──");
            console.log("─▄██▀────▀██▄─────────▄██▀────▀██▄");
            console.log("─██────────██─────────██────────██");
            console.log("─██───██───██─────────██───██───██");
            console.log("─██────────██─────────██────────██");
            console.log("──██▄────▄██───────────██▄────▄██─");
            console.log("───▀██████▀─────────────▀██████▀──");
            console.log("──────────────────────────────────");
            console.log("──────────────────────────────────");
            console.log("──────────────────────────────────");
            console.log("───────────█████████████──────────");
            console.log(" ──────────────────────────────────");
            console.log(" ──────────────────────────────────");
            this.gameOver();
        }
    },

    addScore: function() {
        scoreText = game.add.text(25, 0, 'Score: ' + score, { font:"bold 20px", color: "black"});

        timer = game.time.create(false);
        timer.loop(1000, this.updateScore, this);
        timer.start();
    },

    updateScore: function() {
        score++;
        scoreText.text = 'Score: ' + score;
    },

    toggleMusic: function() {
        if (!this.music.mute) {
            this.music.mute = true;
            this.soundButton.setFrames(0, 0, 1);
        } else {
            this.music.mute = false;
            this.soundButton.setFrames(1, 1, 0);
        }
    },

    gameOver: function() {
        this.music.pause();
        this.gameOverMusic.play();

        gameOn = false;

        olaf.visible = false;
        game.time.events.stop();
        timer.stop();

        scoreText.setStyle({font:"bold 50px", color: "black", align: "center"});
        scoreText.x = game.world.centerX - 100;
        scoreText.y = game.world.centerY - 300;

        this.tileGroup.visible = false;
        this.crackGroup.removeAll(true);
        this.lavaGroup.removeAll(true);
        this.buttonGroup.visible = false;

        this.menuGroup.visible = true;

        //this.restartButton.onInputDown.add(this.restartGame, this);
    },

    addMenu: function() {
        this.gameOverMenu = game.add.sprite(this.game.world.centerX, this.game.world.centerY - 50, 'over-menu');
        this.gameOverMenu.anchor.setTo(0.5);
        this.restartButton = game.add.button(this.game.world.centerX - 5, this.game.world.centerY - 100, 'restart', this.restartGame, this, 0, 3, 2);
        this.restartButton.anchor.setTo(0.5);
        this.menuGroup.add(this.gameOverMenu);
        this.menuGroup.add(this.restartButton);
        this.menuGroup.visible = false;
    },

    restartGame: function() {
        this.menuGroup.visible = false;
        scoreText.destroy();
        this.resumeGame();
    },

    dummy: function() {
        console.log('dummied');
    }
};


game.state.add('GameState', GameState);
game.state.start('GameState');


function hideAddressBar()
{
    if(!window.location.hash)
    {
        if(document.height < window.outerHeight)
        {
            document.body.style.height = (window.outerHeight + 50) + 'px';
        }

        setTimeout( function(){ window.scrollTo(0, 1); }, 50 );
    }
}

window.addEventListener("load", function(){ if(!window.pageYOffset){ hideAddressBar(); } } );
window.addEventListener("orientationchange", hideAddressBar );
