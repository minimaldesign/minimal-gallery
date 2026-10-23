	<div id="cats">
        <ul>
		    <?php categories(); ?>
	    </ul>
	</div>
	<h1><?php gallery_name('link') ?> | last update <?php last_update_date('m.d.y') ?> | <?php last_update_time() ?></h1>
	<div id="nav">
		<ul>
			<li><? nav_prev('prev'); ?></li><li><? nav_next(); ?></li><li>|</li><li><? nav_first(); ?></li><li><? nav_last(); ?></li><li>|</li><li><? randomizer('rand'); ?></li><li><? slideshow_switch('slides','&ndash; off &ndash;'); ?></li><li>|</li><?php view_switcher('list', 'thumbs', 'file'); ?>
		</ul>
	</div>
	<div id="list" class="view">
		<? list_view(); ?>
	</div>
	<div id="styles">
	   <ul><li>styles:</li><?php style_switcher(); ?></ul>
	</div>
	<div id="footer">
		<?php mg_powered(); ?> &mdash; <?php validation(); ?> &mdash; if it looks weird in your browser, get a <a href="http://www.mozilla.org/products/firefox/" title="Take back the web with Firefox"><span>better one</span></a>
	</div>