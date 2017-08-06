var animData = {
    container: document.getElementById('bm'),
    renderer: 'svg',
    loop: true,
    prerender: false,
    autoplay: false,
    autoloadSegments: false,
	path: 'img/anim/anim_test2.json',
	segments: [1,111]
};

var animation;

animation = bodymovin.loadAnimation(animData);
animation.addEventListener('DOMLoaded', function(e) {
	console.log("Animation says DOM loaded");
	//	Set animation to play first segment
	animation.playSegments([1,111], true);
	// animation.play();
});

$(document).on('click', '.scroll-down', function() {
    $('html, body').animate({
        scrollTop: $('article').offset().top
    }, 1000);
});

$(document).ready(function() {
	//	Initialize ScrollReveal
	window.sr = ScrollReveal();
	sr.reveal('.sr');
});

var alternateAnimation = false;

$(document).on('click', '#bm', function() {
	if(alternateAnimation) {
		console.log("First animation");
		alternateAnimation = false;
		animation.playSegments([[212,239],[1,111]]);
	}
	else {
		console.log("Second animation");
		alternateAnimation = true;
		//	Play transition animation
		animation.playSegments([[111,141],[141,212]]);
	}
	
});